import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_ERROR_MAX_CHARS,
  applyCheckResult,
  isCacheFresh,
  notificationEventId,
  parseCache,
  pendingNotification,
  serialiseCache,
} from "../lib/updates/cache";
import type { Release, UpdateCache } from "../lib/updates/types";

const release: Release = {
  version: "0.11.0", tag: "v0.11.0", name: "0.11.0", notes: "notes",
  url: "https://github.com/parabyte-ca/francine/releases/tag/v0.11.0", published_at: "2026-10-01T00:00:00Z",
};
const now = new Date("2026-10-16T12:00:00Z");

test("a failed check keeps the previous release and records the error", () => {
  const prev: UpdateCache = { release, checked_at: "2026-10-15T12:00:00Z", check_error: "", notified_event_id: "abc" };
  const next = applyCheckResult(prev, { error: "x".repeat(1000) }, now);
  assert.deepEqual(next.release, release);
  assert.equal(next.check_error.length, CHECK_ERROR_MAX_CHARS);
  assert.equal(next.checked_at, now.toISOString());
  assert.equal(next.notified_event_id, "abc");
});

test("a successful check replaces the release and clears the error", () => {
  const prev: UpdateCache = { release: null, checked_at: "", check_error: "old failure", notified_event_id: "" };
  const next = applyCheckResult(prev, { release }, now);
  assert.deepEqual(next.release, release);
  assert.equal(next.check_error, "");
  assert.equal(applyCheckResult(null, { release: null }, now).release, null);
});

test("cache freshness drives the once-a-minute limit", () => {
  const c = (checked_at: string): UpdateCache => ({ release, checked_at, check_error: "", notified_event_id: "" });
  assert.equal(isCacheFresh(c("2026-10-16T11:59:30Z"), now, 60_000), true);
  assert.equal(isCacheFresh(c("2026-10-16T11:58:59Z"), now, 60_000), false);
  assert.equal(isCacheFresh(c("2026-10-16T12:05:00Z"), now, 60_000), false, "a future timestamp is not fresh");
  assert.equal(isCacheFresh(c("garbage"), now, 60_000), false);
  assert.equal(isCacheFresh(null, now, 60_000), false);
});

test("the cache survives a round trip and junk is rejected", () => {
  const c: UpdateCache = { release, checked_at: now.toISOString(), check_error: "", notified_event_id: "id" };
  assert.deepEqual(parseCache(serialiseCache(c)), c);
  assert.equal(parseCache(null), null);
  assert.equal(parseCache("{not json"), null);
  assert.equal(parseCache("[1,2]"), null);
  assert.equal(parseCache(JSON.stringify({ release: { version: "nope" } }))?.release, null);
});

test("the serialised cache always fits in one Google Sheets cell", () => {
  const notes = '"\\\n'.repeat(6_000);
  const out = serialiseCache({ release: { ...release, notes }, checked_at: "", check_error: "", notified_event_id: "" });
  assert.ok(out.length <= 45_000, `got ${out.length} characters`);
  assert.ok(parseCache(out)?.release);
});

test("one notification per release, with a stable id", () => {
  const id = notificationEventId("sheet-1", "0.11.0");
  assert.equal(id, notificationEventId("sheet-1", "0.11.0"));
  assert.notEqual(id, notificationEventId("sheet-2", "0.11.0"));
  assert.notEqual(id, notificationEventId("sheet-1", "0.12.0"));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const cache: UpdateCache = { release, checked_at: "", check_error: "", notified_event_id: "" };
  assert.deepEqual(pendingNotification(cache, "0.10.0", "sheet-1"), { event_id: id, version: "0.11.0" });
  assert.equal(pendingNotification({ ...cache, notified_event_id: id }, "0.10.0", "sheet-1"), null, "rerun sends nothing");
  assert.equal(pendingNotification(cache, "0.11.0", "sheet-1"), null, "not newer");
  assert.equal(pendingNotification({ ...cache, release: null }, "0.10.0", "sheet-1"), null);
});
