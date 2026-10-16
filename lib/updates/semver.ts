// Only plain release versions are accepted: "1.2.3" or "v1.2.3".
// Pre-release and build suffixes are rejected on purpose.
const SEMVER_RE = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

export type SemverTuple = [number, number, number];

export function parseSemver(input: unknown): SemverTuple | null {
  if (typeof input !== "string") return null;
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** "v1.2.3" → "1.2.3"; anything that isn't a plain release version → null. */
export function normaliseVersion(input: unknown): string | null {
  const t = parseSemver(input);
  return t ? t.join(".") : null;
}

/** Negative when a < b, 0 when equal, positive when a > b. Throws on invalid input. */
export function compareSemver(a: string, b: string): number {
  const ta = parseSemver(a);
  const tb = parseSemver(b);
  if (!ta || !tb) throw new Error(`Not a version: ${!ta ? a : b}`);
  for (let i = 0; i < 3; i++) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  const tc = parseSemver(candidate);
  const tr = parseSemver(current);
  if (!tc || !tr) return false;
  return compareSemver(candidate, current) > 0;
}
