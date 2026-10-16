import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSemver, isNewer, normaliseVersion, parseSemver } from "../lib/updates/semver";
import { NOTES_MAX_CHARS, fetchLatestRelease, parseRelease, parseSourceUrl, type FetchLike } from "../lib/updates/release";

test("semver: accepts only plain release versions", () => {
  assert.deepEqual(parseSemver("1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseSemver("v10.0.12"), [10, 0, 12]);
  for (const bad of ["1.2", "1.2.3.4", "01.2.3", "1.2.3-beta", "1.2.3+build", "v", "", " ", "latest", "V1.2.3", 123, null]) {
    assert.equal(parseSemver(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(normaliseVersion("v0.10.0"), "0.10.0");
});

test("semver: compares as integer tuples, not strings", () => {
  assert.ok(compareSemver("0.10.0", "0.9.9") > 0);
  assert.ok(compareSemver("1.0.0", "0.99.99") > 0);
  assert.equal(compareSemver("v1.2.3", "1.2.3"), 0);
  assert.ok(compareSemver("1.2.3", "1.2.10") < 0);
  assert.equal(isNewer("0.10.0", "0.9.4"), true);
  assert.equal(isNewer("0.9.4", "0.9.4"), false);
  assert.equal(isNewer("0.9.3", "0.9.4"), false);
  assert.equal(isNewer("garbage", "0.9.4"), false);
  assert.throws(() => compareSemver("1.2", "1.2.3"));
});

test("source URL: parses owner and name", () => {
  assert.deepEqual(parseSourceUrl("https://github.com/parabyte-ca/francine"), { owner: "parabyte-ca", name: "francine" });
  assert.deepEqual(parseSourceUrl("https://github.com/parabyte-ca/francine.git/"), { owner: "parabyte-ca", name: "francine" });
  for (const bad of [
    "http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com/a", "https://github.com/a/b/c",
    "github.com/a/b", "https://github.com/../b", "https://github.com/a/..", "not a url",
  ]) {
    assert.equal(parseSourceUrl(bad), null, `should reject ${bad}`);
  }
});

const sample = {
  tag_name: "v0.11.0",
  name: "Francine 0.11.0",
  body: "## Notes",
  html_url: "https://github.com/parabyte-ca/francine/releases/tag/v0.11.0",
  published_at: "2026-10-01T12:00:00Z",
  draft: false,
  prerelease: false,
};

test("release parsing: keeps only the fields the page needs", () => {
  assert.deepEqual(parseRelease(sample), {
    version: "0.11.0",
    tag: "v0.11.0",
    name: "Francine 0.11.0",
    notes: "## Notes",
    url: "https://github.com/parabyte-ca/francine/releases/tag/v0.11.0",
    published_at: "2026-10-01T12:00:00Z",
  });
});

test("release parsing: rejects odd tags, drafts and pre-releases", () => {
  for (const tag of ["nightly", "v1.2", "1.2.3-rc1", "release-1.2.3", "", 7]) {
    assert.equal(parseRelease({ ...sample, tag_name: tag }), null, `should reject tag ${JSON.stringify(tag)}`);
  }
  assert.equal(parseRelease({ ...sample, draft: true }), null);
  assert.equal(parseRelease({ ...sample, prerelease: true }), null);
  assert.equal(parseRelease(null), null);
  assert.equal(parseRelease([sample]), null);
});

test("release parsing: caps notes and drops unsafe links", () => {
  const r = parseRelease({ ...sample, body: "x".repeat(NOTES_MAX_CHARS + 500), html_url: "javascript:alert(1)", name: 5 })!;
  assert.equal(r.notes.length, NOTES_MAX_CHARS);
  assert.equal(r.url, "");
  assert.equal(r.name, "v0.11.0");
});

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): FetchLike {
  return async (url, init) => {
    seen.url = url;
    seen.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

test("fetchLatestRelease: calls the latest-release endpoint with only a User-Agent", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const r = await fetchLatestRelease({ owner: "parabyte-ca", name: "francine" }, "0.10.0", fakeFetch(200, sample, seen));
  assert.equal(r?.version, "0.11.0");
  assert.equal(seen.url, "https://api.github.com/repos/parabyte-ca/francine/releases/latest");
  const headers = seen.init?.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], "Francine/0.10.0");
  assert.deepEqual(Object.keys(headers).sort(), ["Accept", "User-Agent", "X-GitHub-Api-Version"]);
  assert.equal(seen.init?.method ?? "GET", "GET");
  assert.equal(seen.init?.body, undefined);
});

test("fetchLatestRelease: no releases yet is not an error", async () => {
  assert.equal(await fetchLatestRelease({ owner: "a", name: "b" }, "1.0.0", fakeFetch(404, { message: "Not Found" })), null);
});

test("fetchLatestRelease: errors are explained", async () => {
  await assert.rejects(fetchLatestRelease({ owner: "a", name: "b" }, "1.0.0", fakeFetch(500, {})), /HTTP 500/);
  await assert.rejects(fetchLatestRelease({ owner: "a", name: "b" }, "1.0.0", fakeFetch(403, {})), /rate limiting/);
  await assert.rejects(fetchLatestRelease({ owner: "a", name: "b" }, "1.0.0", fakeFetch(200, "not json")), /valid JSON/);
  await assert.rejects(fetchLatestRelease({ owner: "a", name: "b" }, "1.0.0", fakeFetch(200, { ...sample, tag_name: "nightly" })), /isn't a version/);
  const offline: FetchLike = async () => { throw new Error("ENOTFOUND"); };
  await assert.rejects(fetchLatestRelease({ owner: "a", name: "b" }, "1.0.0", offline), /Couldn't reach GitHub/);
});

test("fetchLatestRelease: gives up after the timeout", async () => {
  const hang: FetchLike = (_url, init) =>
    new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(fetchLatestRelease({ owner: "a", name: "b" }, "1.0.0", hang, 50), /did not answer/);
});
