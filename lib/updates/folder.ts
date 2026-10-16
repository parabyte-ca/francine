// Reads and writes the shared upgrade folder — the only channel between the
// app container and the root helper on the host. Everything read from it is
// treated as untrusted: oversized, non-object or wrongly typed files are ignored.

import { promises as fs, constants as fsc } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normaliseVersion } from "./semver";
import type {
  AgentHeartbeat,
  DerivedUpgrade,
  UpgradeRequest,
  UpgradeStatusFile,
} from "./types";

export const MAX_FILE_BYTES = 64 * 1024;
export const LOG_TAIL_BYTES = 64 * 1024;
export const REQUEST_STALE_MS = 60 * 60_000;
export const RUNNING_STALE_MS = 3 * 60 * 60_000;
const FUTURE_TOLERANCE_MS = 60_000;
const DEFAULT_EVERY_MINUTES = 15;

const ID_RE = /^[0-9a-fA-F-]{36}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/;

function capStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Tolerant timestamp parser: ISO strings, or epoch seconds / milliseconds. */
export function parseTimestamp(v: unknown): Date | null {
  let ms: number;
  if (typeof v === "number" && Number.isFinite(v)) {
    ms = v < 1e12 ? v * 1000 : v;
  } else if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    ms = /^\d+(\.\d+)?$/.test(s) ? (Number(s) < 1e12 ? Number(s) * 1000 : Number(s)) : Date.parse(s);
  } else {
    return null;
  }
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  return year >= 2000 && year <= 2200 ? d : null;
}

function iso(v: unknown): string {
  const d = parseTimestamp(v);
  return d ? d.toISOString() : "";
}

/** Reads a small JSON object without following symbolic links. Never throws. */
export async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(file, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0));
    const st = await handle.stat();
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const text = await handle.readFile("utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function sanitiseRequest(o: Record<string, unknown> | null): UpgradeRequest | null {
  if (!o) return null;
  const id = capStr(o.id, 36);
  const version = normaliseVersion(o.version);
  const requested_at = iso(o.requested_at);
  if (!ID_RE.test(id) || !version || !requested_at) return null;
  const by = capStr(o.requested_by, 254);
  return { id, version, requested_by: EMAIL_RE.test(by) ? by : "", requested_at };
}

export function sanitiseAgent(o: Record<string, unknown> | null): AgentHeartbeat | null {
  if (!o) return null;
  const last_seen = iso(o.last_seen);
  if (!last_seen) return null;
  const n = typeof o.every_minutes === "string" ? Number(o.every_minutes) : o.every_minutes;
  const every_minutes =
    typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 60 ? n : DEFAULT_EVERY_MINUTES;
  return { last_seen, every_minutes };
}

export function sanitiseStatus(o: Record<string, unknown> | null): UpgradeStatusFile | null {
  if (!o) return null;
  const state = o.state;
  if (state !== "running" && state !== "succeeded" && state !== "failed") return null;
  return {
    id: capStr(o.id, 36),
    state,
    from_version: normaliseVersion(o.from_version) ?? "",
    to_version: normaliseVersion(o.to_version) ?? "",
    requested_by: capStr(o.requested_by, 254),
    started_at: iso(o.started_at),
    finished_at: iso(o.finished_at),
    message: capStr(o.message, 500),
  };
}

/**
 * The helper counts as connected when it checked in within
 * max(3, 2 × interval + 1) minutes — one missed run is tolerated — and its
 * heartbeat isn't more than a minute in the future (a skewed clock isn't a live helper).
 */
export function isHelperConnected(agent: AgentHeartbeat | null, now: Date): boolean {
  if (!agent) return false;
  const seen = Date.parse(agent.last_seen);
  if (Number.isNaN(seen)) return false;
  const windowMs = Math.max(3, 2 * agent.every_minutes + 1) * 60_000;
  const age = now.getTime() - seen;
  return age <= windowMs && age >= -FUTURE_TOLERANCE_MS;
}

const IDLE: DerivedUpgrade = {
  state: "idle",
  id: "",
  from_version: "",
  to_version: "",
  requested_by: "",
  requested_at: "",
  started_at: "",
  finished_at: "",
  message: "",
  in_progress: false,
};

/**
 * Works out what the page should show. Stale states turn into "failed" so a
 * stuck upgrade never blocks the next one.
 */
export function deriveUpgradeState(
  request: UpgradeRequest | null,
  status: UpgradeStatusFile | null,
  now: Date,
): DerivedUpgrade {
  if (request) {
    const base = {
      ...IDLE,
      id: request.id,
      to_version: request.version,
      requested_by: request.requested_by,
      requested_at: request.requested_at,
    };
    if (now.getTime() - Date.parse(request.requested_at) > REQUEST_STALE_MS) {
      return {
        ...base,
        state: "failed",
        message: "The upgrade wasn't started: the helper never picked this request up.",
      };
    }
    return { ...base, state: "requested", in_progress: true };
  }

  if (!status) return IDLE;

  const derived: DerivedUpgrade = {
    ...IDLE,
    state: status.state,
    id: status.id,
    from_version: status.from_version,
    to_version: status.to_version,
    requested_by: status.requested_by,
    started_at: status.started_at,
    finished_at: status.finished_at,
    message: status.message,
  };
  if (status.state === "running") {
    const started = Date.parse(status.started_at);
    if (Number.isNaN(started) || now.getTime() - started > RUNNING_STALE_MS) {
      return {
        ...derived,
        state: "failed",
        message: "The upgrade didn't finish: the helper stopped reporting. Check the server.",
      };
    }
    return { ...derived, in_progress: true };
  }
  return derived;
}

export interface FolderSnapshot {
  available: boolean;
  request: UpgradeRequest | null;
  agent: AgentHeartbeat | null;
  status: UpgradeStatusFile | null;
}

export async function readFolder(dir: string | null): Promise<FolderSnapshot> {
  if (!dir) return { available: false, request: null, agent: null, status: null };
  let available = false;
  try {
    available = (await fs.stat(dir)).isDirectory();
  } catch {
    available = false;
  }
  if (!available) return { available, request: null, agent: null, status: null };
  const [request, agent, status] = await Promise.all([
    readJsonObject(path.join(dir, "request.json")).then(sanitiseRequest),
    readJsonObject(path.join(dir, "agent.json")).then(sanitiseAgent),
    readJsonObject(path.join(dir, "status.json")).then(sanitiseStatus),
  ]);
  return { available, request, agent, status };
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** The last part of upgrade.log, cleaned of terminal colour codes. Never throws. */
export async function readLogTail(dir: string | null, maxBytes = LOG_TAIL_BYTES): Promise<string> {
  if (!dir) return "";
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(path.join(dir, "upgrade.log"), fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0));
    const st = await handle.stat();
    if (!st.isFile() || st.size === 0) return "";
    const length = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, st.size - length);
    let text = buf.toString("utf8");
    if (length < st.size) {
      // Drop the partial first line left by cutting mid-file.
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : text;
    }
    return text.replace(/\r\n?/g, "\n").replace(ANSI_RE, "").replace(CONTROL_RE, "");
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Writes request.json atomically: a temporary file first, then a rename over the old one. */
export async function writeRequestAtomic(dir: string, request: UpgradeRequest): Promise<void> {
  const tmp = path.join(dir, `.request.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, `${JSON.stringify(request)}\n`, { mode: 0o640, flag: "wx" });
    await fs.rename(tmp, path.join(dir, "request.json"));
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}
