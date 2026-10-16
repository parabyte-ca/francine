import { normaliseVersion } from "./semver";
import type { Release } from "./types";

export const NOTES_MAX_CHARS = 20_000;
const NAME_MAX_CHARS = 200;

export interface RepoRef {
  owner: string;
  name: string;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Accepts https://github.com/owner/name (optionally ending in .git or /). */
export function parseSourceUrl(url: string): RepoRef | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "github.com") return null;
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/, "");
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === "." || name === "..") return null;
  return { owner, name };
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Turns a GitHub "latest release" response into a Release, or null when the tag isn't a plain version. */
export function parseRelease(json: unknown): Release | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (o.draft === true || o.prerelease === true) return null;
  const tag = typeof o.tag_name === "string" ? o.tag_name.trim() : "";
  const version = normaliseVersion(tag);
  if (!version) return null;

  const url = str(o.html_url, 500);
  const published = str(o.published_at, 40);
  return {
    version,
    tag: tag.slice(0, 50),
    name: str(o.name, NAME_MAX_CHARS).trim() || tag,
    notes: str(o.body, NOTES_MAX_CHARS),
    url: url.startsWith("https://github.com/") ? url : "",
    published_at: published && !Number.isNaN(Date.parse(published)) ? published : "",
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Asks GitHub for the latest published release. Resolves to null when the
 * repository has no releases yet. Only a User-Agent naming the app and its
 * version is sent — nothing about the server.
 */
export async function fetchLatestRelease(
  repo: RepoRef,
  appVersion: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<Release | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Francine/${appVersion}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (controller.signal.aborted) throw new Error("GitHub did not answer within 10 seconds.");
    throw new Error(`Couldn't reach GitHub: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    throw new Error(`GitHub refused the request (HTTP ${res.status}); it may be rate limiting this server. Try again later.`);
  }
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}.`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("GitHub sent a response that isn't valid JSON.");
  }
  const release = parseRelease(body);
  if (!release) {
    const tag = body && typeof body === "object" ? String((body as { tag_name?: unknown }).tag_name ?? "") : "";
    throw new Error(`The latest release tag "${tag.slice(0, 50)}" isn't a version like 1.2.3, so it was ignored.`);
  }
  return release;
}
