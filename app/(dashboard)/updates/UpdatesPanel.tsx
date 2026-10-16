"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, ArrowUpCircle, CheckCircle2, ExternalLink, Info, Loader2, RefreshCw, Server, XCircle,
} from "lucide-react";
import Markdown from "@/components/Markdown";
import { FAST_POLL_MS, SLOW_POLL_MS, describeUpgrade, minutesLabel, type Tone } from "@/lib/updates/view-model";
import type { UpdateStatus } from "@/lib/updates/types";

function when(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "never";
  const exact = d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  return `${formatDistanceToNow(d, { addSuffix: true })} (${exact})`;
}

const TONE_CLASSES: Record<Tone, string> = {
  info: "bg-blue-50 border-blue-200 text-blue-900",
  success: "bg-green-50 border-green-200 text-green-900",
  warning: "bg-amber-50 border-amber-200 text-amber-900",
  error: "bg-red-50 border-red-200 text-red-900",
};

const TONE_ICONS: Record<Tone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

async function errorText(res: Response): Promise<string> {
  const json = await res.json().catch(() => ({}));
  return typeof json.error === "string" ? json.error : `The server answered with HTTP ${res.status}.`;
}

export default function UpdatesPanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const statusRef = useRef<UpdateStatus | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const apply = (next: UpdateStatus) => {
    statusRef.current = next;
    setStatus(next);
    setUnreachable(false);
    setLoadError("");
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/updates", { cache: "no-store" });
      if (res.status === 401) {
        setLoadError("Your session has ended. Reload the page and sign in again.");
        return;
      }
      if (!res.ok) throw new Error(await errorText(res));
      apply((await res.json()).data);
    } catch {
      // During an upgrade Francine restarts, so requests fail for about a minute.
      if (statusRef.current?.upgrade.in_progress) setUnreachable(true);
      else setLoadError("Couldn't load the update status. Trying again shortly.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const view = status ? describeUpgrade(status, { unreachable }) : null;
  const pollMs = view?.pollMs ?? (loadError ? SLOW_POLL_MS : FAST_POLL_MS);

  useEffect(() => {
    if (!status && !loadError) return;
    const t = setTimeout(load, pollMs);
    return () => clearTimeout(t);
  }, [status, unreachable, loadError, pollMs, load]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [status?.log]);

  const checkNow = async () => {
    setChecking(true);
    setActionError("");
    try {
      const res = await fetch("/api/admin/updates/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(await errorText(res));
      apply((await res.json()).data);
    } catch (err) {
      setActionError(`The check didn't work: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setChecking(false);
    }
  };

  const requestUpgrade = async () => {
    if (!status?.latest) return;
    setRequesting(true);
    setActionError("");
    try {
      const res = await fetch("/api/admin/updates/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: status.latest.version }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      apply((await res.json()).data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
      setConfirmOpen(false);
    }
  };

  if (!status) {
    return (
      <div className="card flex items-center gap-3 text-sm text-gray-600" role="status" aria-live="polite">
        {loadError ? (
          <>
            <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden /> {loadError}
          </>
        ) : (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading update status…
          </>
        )}
      </div>
    );
  }

  const { latest, helper, upgrade } = status;
  const ToneIcon = TONE_ICONS[view!.tone];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Versions ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="updates-version-heading" className="card space-y-4">
        <h2 id="updates-version-heading" className="font-semibold text-gray-900">Version</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-600">Running on this server</dt>
            <dd className="text-lg font-semibold text-gray-900">{status.current_version}</dd>
          </div>
          <div>
            <dt className="text-gray-600">Latest release</dt>
            <dd className="text-lg font-semibold text-gray-900">
              {latest ? latest.version : "None published yet"}
              {latest && status.update_available && <span className="badge-blue ml-2 align-middle">Update available</span>}
              {latest && !status.update_available && <span className="badge-green ml-2 align-middle">Up to date</span>}
            </dd>
            {latest?.published_at && (
              <dd className="text-xs text-gray-600">Published {when(latest.published_at)}</dd>
            )}
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" onClick={checkNow} disabled={checking} className="btn-secondary" aria-busy={checking}>
            {checking ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}
            Check now
          </button>
          <span className="text-gray-600">Last checked {when(status.checked_at)}</span>
        </div>
        {!status.check_enabled && (
          <p className="text-xs text-gray-600">
            Daily release checks are turned off (APP_UPDATE_CHECK=false). “Check now” still works.
          </p>
        )}
        {status.check_error && (
          <p className="text-sm rounded-lg border px-3 py-2 bg-amber-50 border-amber-200 text-amber-900">
            The last check didn&apos;t work: {status.check_error}
            {latest && " The release shown is from the last successful check."}
          </p>
        )}
      </section>

      {/* ── Upgrade ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="updates-upgrade-heading" className="card space-y-4">
        <h2 id="updates-upgrade-heading" className="font-semibold text-gray-900">Upgrade</h2>
        <div role="status" aria-live="polite" className={`rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[view!.tone]}`}>
          <p className="font-medium flex items-center gap-2">
            {upgrade.state === "running" || unreachable ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
            ) : (
              <ToneIcon className="w-4 h-4 shrink-0" aria-hidden />
            )}
            {view!.headline}
          </p>
          {view!.detail && <p className="mt-1">{view!.detail}</p>}
          {upgrade.state === "requested" && upgrade.requested_at && (
            <p className="mt-1 text-xs opacity-80">Requested {when(upgrade.requested_at)}{upgrade.requested_by && ` by ${upgrade.requested_by}`}.</p>
          )}
          {upgrade.state === "running" && upgrade.started_at && (
            <p className="mt-1 text-xs opacity-80">Started {when(upgrade.started_at)}.</p>
          )}
          {(upgrade.state === "succeeded" || upgrade.state === "failed") && upgrade.finished_at && (
            <p className="mt-1 text-xs opacity-80">Finished {when(upgrade.finished_at)}.</p>
          )}
        </div>

        {view!.warning && (
          <p className="text-sm rounded-lg border px-3 py-2 bg-amber-50 border-amber-200 text-amber-900 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {view!.warning}
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-sm rounded-lg border px-3 py-2 bg-red-50 border-red-200 text-red-900">
            {actionError}
          </p>
        )}

        {((view!.showUpgradeButton && latest) || view!.showReload) && (
        <div className="flex flex-wrap gap-3">
          {view!.showUpgradeButton && latest && (
            <button type="button" className="btn-primary" onClick={() => setConfirmOpen(true)}>
              <ArrowUpCircle className="w-4 h-4" aria-hidden /> Upgrade to {latest.version}
            </button>
          )}
          {view!.showReload && (
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw className="w-4 h-4" aria-hidden /> Reload the page
            </button>
          )}
        </div>
        )}
        <p className="text-xs text-gray-600">
          You can also upgrade from a terminal on the server: <code className="bg-gray-100 text-gray-800 px-1 rounded">./update.sh --pull</code>
        </p>
      </section>

      {/* ── Release notes ────────────────────────────────────────────────── */}
      {latest && (
        <section aria-labelledby="updates-notes-heading" className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="updates-notes-heading" className="font-semibold text-gray-900">
              Release notes: {latest.name || latest.version}
            </h2>
            {latest.url && (
              <a href={latest.url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-700 hover:underline inline-flex items-center gap-1">
                View on GitHub <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </div>
          {latest.notes.trim() ? (
            <Markdown source={latest.notes} />
          ) : (
            <p className="text-sm text-gray-600">No release notes were published for this version.</p>
          )}
        </section>
      )}

      {/* ── Server helper ────────────────────────────────────────────────── */}
      <section aria-labelledby="updates-helper-heading" className="card space-y-3 text-sm">
        <h2 id="updates-helper-heading" className="font-semibold text-gray-900 flex items-center gap-2">
          <Server className="w-4 h-4 text-gray-400" aria-hidden /> Server helper
        </h2>
        <p className="text-gray-600">
          Francine can&apos;t upgrade itself from inside its container. A small helper on the server checks for
          upgrade requests on a schedule and runs the upgrade for it.
        </p>

        {helper.connected ? (
          <p className="flex gap-2 text-green-800">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>
              Connected. Last check-in: {when(helper.last_seen)}. It checks every {minutesLabel(helper.every_minutes)}.
            </span>
          </p>
        ) : helper.configured ? (
          <p className="flex gap-2 text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>
              Not connected. Last check-in: {when(helper.last_seen)}. Make sure its schedule is still installed on the
              server, or run the setup command below again.
            </span>
          </p>
        ) : (
          <p className="flex gap-2 text-gray-700">
            <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> Not set up yet.
          </p>
        )}

        {!helper.folder_available && (
          <p className="text-amber-900">
            The shared upgrade folder isn&apos;t mounted in Francine&apos;s container yet. Run{" "}
            <code className="bg-gray-100 text-gray-800 px-1 rounded">./update.sh</code> once on the server to add it.
          </p>
        )}

        {!helper.connected && (
          <div className="space-y-2">
            <p className="text-gray-700">To set it up, run this on the server from the Francine folder:</p>
            <pre className="bg-gray-900 text-gray-100 rounded-lg px-3 py-2 overflow-x-auto text-xs">
              <code>sudo ./scripts/upgrade-agent.sh --install</code>
            </pre>
            <p className="text-gray-600">
              If the server&apos;s scheduler is managed somewhere else, such as a NAS web interface, run{" "}
              <code className="bg-gray-100 text-gray-800 px-1 rounded">./scripts/upgrade-agent.sh --print</code> and add the command it
              shows to that scheduler instead.
            </p>
          </div>
        )}
      </section>

      {/* ── Log ──────────────────────────────────────────────────────────── */}
      {status.log && (
        <section aria-labelledby="updates-log-heading" className="card space-y-3">
          <h2 id="updates-log-heading" className="font-semibold text-gray-900">Upgrade log</h2>
          <pre
            ref={logRef}
            tabIndex={0}
            aria-labelledby="updates-log-heading"
            className="bg-gray-900 text-gray-100 rounded-lg p-3 max-h-80 overflow-auto text-xs whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {status.log}
          </pre>
        </section>
      )}

      {/* ── Confirm dialog ───────────────────────────────────────────────── */}
      <Dialog.Root open={confirmOpen} onOpenChange={(open) => !requesting && setConfirmOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-xl shadow-2xl w-[calc(100%-2rem)] max-w-md p-6 space-y-4 focus:outline-none">
            <Dialog.Title className="font-semibold text-gray-900">Upgrade to {latest?.version}?</Dialog.Title>
            <Dialog.Description className="text-sm text-gray-600 space-y-2">
              Francine will be unavailable for about a minute while it restarts. The Google Sheet is backed up
              first, and if the new version doesn&apos;t start, the server goes back to {status.current_version}.
            </Dialog.Description>
            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary" disabled={requesting}>Cancel</button>
              </Dialog.Close>
              <button type="button" className="btn-primary" onClick={requestUpgrade} disabled={requesting} aria-busy={requesting}>
                {requesting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                Upgrade now
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
