import { v5 as uuidv5 } from "uuid";
import { isNewer, normaliseVersion } from "./semver";
import { NOTES_MAX_CHARS } from "./release";
import type { Release, UpdateCache } from "./types";

export const CHECK_ERROR_MAX_CHARS = 300;
export const MIN_CHECK_INTERVAL_MS = 60_000;
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60_000;
// A Google Sheets cell holds at most 50,000 characters.
const SERIALISED_MAX_CHARS = 45_000;
// Fixed namespace so the same deployment + version always yields the same event id.
const NOTIFY_NAMESPACE = "6f2c8a51-3d7e-4b9a-9c1e-5a4f0b2d7e93";

export type CheckOutcome = { release: Release | null } | { error: string };

export function applyCheckResult(prev: UpdateCache | null, outcome: CheckOutcome, now: Date): UpdateCache {
  const base = {
    checked_at: now.toISOString(),
    notified_event_id: prev?.notified_event_id ?? "",
  };
  if ("error" in outcome) {
    // Keep the last good answer so a GitHub outage doesn't hide a known release.
    return { ...base, release: prev?.release ?? null, check_error: outcome.error.slice(0, CHECK_ERROR_MAX_CHARS) };
  }
  return { ...base, release: outcome.release, check_error: "" };
}

/** True when the cached answer is recent enough to serve instead of asking GitHub again. */
export function isCacheFresh(cache: UpdateCache | null, now: Date, maxAgeMs: number): boolean {
  if (!cache) return false;
  const t = Date.parse(cache.checked_at);
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age < maxAgeMs;
}

function sanitiseRelease(v: unknown): Release | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const version = normaliseVersion(o.version);
  if (!version) return null;
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  const url = s(o.url, 500);
  return {
    version,
    tag: s(o.tag, 50) || version,
    name: s(o.name, 200) || version,
    notes: s(o.notes, NOTES_MAX_CHARS),
    url: url.startsWith("https://github.com/") ? url : "",
    published_at: s(o.published_at, 40),
  };
}

export function parseCache(raw: string | null): UpdateCache | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  return {
    release: sanitiseRelease(r.release),
    checked_at: typeof r.checked_at === "string" ? r.checked_at.slice(0, 40) : "",
    check_error: typeof r.check_error === "string" ? r.check_error.slice(0, CHECK_ERROR_MAX_CHARS) : "",
    notified_event_id: typeof r.notified_event_id === "string" ? r.notified_event_id.slice(0, 36) : "",
  };
}

export function serialiseCache(cache: UpdateCache): string {
  let out = JSON.stringify(cache);
  if (out.length <= SERIALISED_MAX_CHARS || !cache.release) return out;
  // Escaped characters can make the notes grow when serialised; trim until it fits.
  let notes = cache.release.notes;
  while (out.length > SERIALISED_MAX_CHARS && notes.length > 0) {
    notes = notes.slice(0, Math.floor(notes.length * 0.8));
    out = JSON.stringify({ ...cache, release: { ...cache.release, notes: `${notes}\n\n…` } });
  }
  return out;
}

export function notificationEventId(tenant: string, version: string): string {
  return uuidv5(`${tenant}:${version}`, NOTIFY_NAMESPACE);
}

/** The "update available" event to record, or null when there is nothing new to announce. */
export function pendingNotification(
  cache: UpdateCache,
  currentVersion: string,
  tenant: string,
): { event_id: string; version: string } | null {
  const release = cache.release;
  if (!release || !isNewer(release.version, currentVersion)) return null;
  const event_id = notificationEventId(tenant, release.version);
  if (cache.notified_event_id === event_id) return null;
  return { event_id, version: release.version };
}
