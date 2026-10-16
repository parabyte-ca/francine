// Server-only glue: settings, the cached release check (Config tab), the
// shared upgrade folder and the audit log.

import { randomUUID } from "node:crypto";
import { APP_VERSION } from "@/lib/version";
import { appendAuditEvent, auditEventExists, getConfig, setConfig } from "@/lib/google/sheets";
import { fetchLatestRelease, parseSourceUrl } from "./release";
import {
  AUTO_CHECK_INTERVAL_MS,
  MIN_CHECK_INTERVAL_MS,
  applyCheckResult,
  isCacheFresh,
  parseCache,
  pendingNotification,
  serialiseCache,
  type CheckOutcome,
} from "./cache";
import {
  deriveUpgradeState,
  isHelperConnected,
  readFolder,
  readLogTail,
  writeRequestAtomic,
} from "./folder";
import { computeCanUpgrade, evaluateUpgradeRequest, type Refusal } from "./policy";
import { isNewer } from "./semver";
import type { UpdateCache, UpdateStatus } from "./types";

const CACHE_KEY = "update_check";
const DEFAULT_SOURCE_URL = "https://github.com/parabyte-ca/francine";

export function updateSettings() {
  const flag = (process.env.APP_UPDATE_CHECK ?? "").trim().toLowerCase();
  return {
    sourceUrl: (process.env.APP_SOURCE_URL ?? "").trim() || DEFAULT_SOURCE_URL,
    checkEnabled: !["false", "0", "no", "off"].includes(flag),
    upgradeDir: (process.env.APP_UPGRADE_DIR ?? "").trim() || "/upgrade",
  };
}

async function loadCache(): Promise<UpdateCache | null> {
  return parseCache(await getConfig(CACHE_KEY));
}

/**
 * Asks GitHub for the latest release unless the cached answer is younger
 * than `minAgeMs`. A failed check keeps the previous release and records the error.
 */
export async function runReleaseCheck(minAgeMs = MIN_CHECK_INTERVAL_MS): Promise<UpdateCache> {
  const now = new Date();
  const prev = await loadCache();
  if (isCacheFresh(prev, now, minAgeMs)) return prev!;

  const { sourceUrl } = updateSettings();
  const repo = parseSourceUrl(sourceUrl);
  let outcome: CheckOutcome;
  if (!repo) {
    outcome = { error: `APP_SOURCE_URL must look like https://github.com/owner/name (it is "${sourceUrl.slice(0, 100)}").` };
  } else {
    try {
      outcome = { release: await fetchLatestRelease(repo, APP_VERSION) };
    } catch (err) {
      outcome = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const next = applyCheckResult(prev, outcome, now);

  // Record one "update available" event per release. The id is derived from
  // the deployment and version, so reruns can never add a second row.
  const pending = pendingNotification(next, APP_VERSION, process.env.GOOGLE_SHEET_ID ?? "francine");
  if (pending) {
    try {
      if (!(await auditEventExists(pending.event_id))) {
        await appendAuditEvent({
          event_id: pending.event_id,
          event: "system.update_available",
          actor: "system",
          details: { current_version: APP_VERSION, available_version: pending.version },
        });
      }
      next.notified_event_id = pending.event_id;
    } catch (err) {
      console.warn("[updates] Couldn't record update notification:", err instanceof Error ? err.message : err);
    }
  }

  try {
    await setConfig(CACHE_KEY, serialiseCache(next));
  } catch (err) {
    console.warn("[updates] Couldn't save release check:", err instanceof Error ? err.message : err);
  }
  return next;
}

export async function getUpdateStatus(opts: { includeLog: boolean }): Promise<UpdateStatus> {
  const settings = updateSettings();
  let cache = await loadCache();
  // Keep the answer at most a day old even when the scheduled check isn't set up.
  if (settings.checkEnabled && !isCacheFresh(cache, new Date(), AUTO_CHECK_INTERVAL_MS)) {
    cache = await runReleaseCheck(AUTO_CHECK_INTERVAL_MS);
  }

  const now = new Date();
  const folder = await readFolder(settings.upgradeDir);
  const connected = isHelperConnected(folder.agent, now);
  const upgrade = deriveUpgradeState(folder.request, folder.status, now);
  const latest = cache?.release ?? null;
  const updateAvailable = !!latest && isNewer(latest.version, APP_VERSION);

  return {
    current_version: APP_VERSION,
    source_url: settings.sourceUrl,
    check_enabled: settings.checkEnabled,
    latest,
    update_available: updateAvailable,
    checked_at: cache?.checked_at ?? "",
    check_error: cache?.check_error ?? "",
    helper: {
      folder_available: folder.available,
      configured: !!folder.agent,
      connected,
      last_seen: folder.agent?.last_seen ?? "",
      every_minutes: folder.agent?.every_minutes ?? 15,
    },
    upgrade,
    can_upgrade: computeCanUpgrade({ updateAvailable, helperConnected: connected, inProgress: upgrade.in_progress }),
    log: opts.includeLog ? await readLogTail(folder.available ? settings.upgradeDir : null) : "",
  };
}

export async function requestUpgrade(
  requestedVersion: unknown,
  actorEmail: string,
): Promise<{ ok: true; status: UpdateStatus } | Refusal> {
  const settings = updateSettings();
  const status = await getUpdateStatus({ includeLog: false });
  const verdict = evaluateUpgradeRequest({
    requestedVersion,
    currentVersion: APP_VERSION,
    latest: status.latest,
    helperConnected: status.helper.connected,
    inProgress: status.upgrade.in_progress,
  });
  if (!verdict.ok) return verdict;

  const id = randomUUID();
  try {
    await writeRequestAtomic(settings.upgradeDir, {
      id,
      version: verdict.version,
      requested_by: actorEmail,
      requested_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[updates] Couldn't write upgrade request:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      status: 500,
      error:
        "Francine couldn't write the upgrade request to the shared folder. On the server, run " +
        "“sudo ./scripts/upgrade-agent.sh --install” from the Francine folder to fix its permissions.",
    };
  }

  try {
    await appendAuditEvent({
      event_id: id,
      event: "system.upgrade_requested",
      actor: actorEmail,
      details: { from_version: APP_VERSION, to_version: verdict.version },
    });
  } catch (err) {
    console.warn("[updates] Couldn't record audit event:", err instanceof Error ? err.message : err);
  }

  return { ok: true, status: await getUpdateStatus({ includeLog: true }) };
}
