import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_FILE_BYTES,
  deriveUpgradeState,
  isHelperConnected,
  parseTimestamp,
  readFolder,
  readLogTail,
  sanitiseAgent,
  sanitiseStatus,
  writeRequestAtomic,
} from "../lib/updates/folder";
import type { UpgradeRequest, UpgradeStatusFile } from "../lib/updates/types";

let dir = "";
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "francine-upgrade-test-"));
});
after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const minutes = (n: number) => n * 60_000;
const NOW = new Date("2026-10-16T12:00:00Z");
const at = (offsetMinutes: number) => new Date(NOW.getTime() + minutes(offsetMinutes)).toISOString();

test("helper connection tolerates one missed run", () => {
  const agent = (lastSeenOffset: number, every: number) => ({ last_seen: at(lastSeenOffset), every_minutes: every });
  // every 15 minutes → window is 31 minutes
  assert.equal(isHelperConnected(agent(-30, 15), NOW), true);
  assert.equal(isHelperConnected(agent(-31, 15), NOW), true);
  assert.equal(isHelperConnected(agent(-32, 15), NOW), false);
  // every minute → the window never drops below 3 minutes
  assert.equal(isHelperConnected(agent(-3, 1), NOW), true);
  assert.equal(isHelperConnected(agent(-4, 1), NOW), false);
  assert.equal(isHelperConnected(null, NOW), false);
});

test("a heartbeat from the future isn't a live helper", () => {
  assert.equal(isHelperConnected({ last_seen: at(0.5), every_minutes: 15 }, NOW), true);
  assert.equal(isHelperConnected({ last_seen: at(2), every_minutes: 15 }, NOW), false);
});

test("timestamps are parsed tolerantly", () => {
  assert.equal(parseTimestamp("2026-10-16T12:00:00Z")?.toISOString(), NOW.toISOString());
  assert.equal(parseTimestamp(NOW.getTime() / 1000)?.toISOString(), NOW.toISOString());
  assert.equal(parseTimestamp(String(NOW.getTime()))?.toISOString(), NOW.toISOString());
  for (const bad of ["", "yesterday", null, {}, Number.NaN, "1970-01-01T00:00:00Z", "9999-01-01T00:00:00Z"]) {
    assert.equal(parseTimestamp(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

const request = (offsetMinutes: number): UpgradeRequest => ({
  id: "0b6f4e2a-9c1d-4f3b-8a7e-2d5c6b1a9e0f", version: "0.11.0", requested_by: "owner@example.ca", requested_at: at(offsetMinutes),
});
const status = (state: UpgradeStatusFile["state"], startedOffset: number): UpgradeStatusFile => ({
  id: "x", state, from_version: "0.10.0", to_version: "0.11.0", requested_by: "owner@example.ca",
  started_at: at(startedOffset), finished_at: "", message: "msg",
});

test("a waiting request is 'requested' until it is over an hour old", () => {
  const fresh = deriveUpgradeState(request(-59), null, NOW);
  assert.equal(fresh.state, "requested");
  assert.equal(fresh.in_progress, true);
  const stale = deriveUpgradeState(request(-61), null, NOW);
  assert.equal(stale.state, "failed");
  assert.equal(stale.in_progress, false);
  assert.match(stale.message, /never picked this request up/);
});

test("a running upgrade becomes 'failed' after three hours without news", () => {
  assert.equal(deriveUpgradeState(null, status("running", -179), NOW).state, "running");
  const stale = deriveUpgradeState(null, status("running", -181), NOW);
  assert.equal(stale.state, "failed");
  assert.equal(stale.in_progress, false);
  assert.match(stale.message, /stopped reporting/);
  assert.equal(deriveUpgradeState(null, { ...status("running", 0), started_at: "" }, NOW).state, "failed");
});

test("finished upgrades and an empty folder are reported as they are", () => {
  assert.equal(deriveUpgradeState(null, status("succeeded", -500), NOW).state, "succeeded");
  assert.equal(deriveUpgradeState(null, status("failed", -5), NOW).state, "failed");
  assert.equal(deriveUpgradeState(null, null, NOW).state, "idle");
  // A new request wins over the result of the last upgrade.
  assert.equal(deriveUpgradeState(request(-1), status("failed", -60), NOW).state, "requested");
});

test("wrongly typed fields are dropped or defaulted", () => {
  assert.equal(sanitiseAgent({ last_seen: 5, every_minutes: "x" }), null);
  assert.deepEqual(sanitiseAgent({ last_seen: NOW.toISOString(), every_minutes: 999 }), { last_seen: NOW.toISOString(), every_minutes: 15 });
  assert.equal(sanitiseStatus({ state: "exploded" }), null);
  const s = sanitiseStatus({ state: "failed", message: "m".repeat(5000), to_version: "1.2", id: ["x"] })!;
  assert.equal(s.message.length, 500);
  assert.equal(s.to_version, "");
  assert.equal(s.id, "");
});

async function put(name: string, content: string | Buffer) {
  await fs.rm(path.join(dir, name), { force: true, recursive: true });
  await fs.writeFile(path.join(dir, name), content);
}

test("malformed, oversized or wrongly typed files never break the status", async () => {
  const cases: [string, string | Buffer][] = [
    ["not json", "{oops"],
    ["array", "[1,2,3]"],
    ["null", "null"],
    ["string", '"hello"'],
    ["wrong types", JSON.stringify({ id: 1, version: true, requested_at: [] })],
    ["oversized", JSON.stringify({ pad: "x".repeat(MAX_FILE_BYTES) })],
    ["binary", Buffer.from([0xff, 0xfe, 0x00, 0x01])],
  ];
  for (const [label, content] of cases) {
    await put("request.json", content);
    await put("agent.json", content);
    await put("status.json", content);
    const snap = await readFolder(dir);
    assert.equal(snap.available, true, label);
    assert.deepEqual([snap.request, snap.agent, snap.status], [null, null, null], label);
  }
  await fs.rm(path.join(dir, "status.json"));
  await fs.mkdir(path.join(dir, "status.json"));
  assert.equal((await readFolder(dir)).status, null, "a directory in place of a file");
  await fs.rm(path.join(dir, "status.json"), { recursive: true });
});

test("files that are symbolic links are ignored", async () => {
  const target = path.join(dir, "outside.json");
  await fs.writeFile(target, JSON.stringify({ last_seen: NOW.toISOString(), every_minutes: 5 }));
  await fs.rm(path.join(dir, "agent.json"), { force: true });
  await fs.symlink(target, path.join(dir, "agent.json"));
  assert.equal((await readFolder(dir)).agent, null);
  await fs.rm(path.join(dir, "agent.json"));
});

test("a missing folder is reported as unavailable", async () => {
  assert.equal((await readFolder(path.join(dir, "nope"))).available, false);
  assert.equal((await readFolder(null)).available, false);
});

test("the request is written atomically and replaces the old one", async () => {
  const sub = await fs.mkdtemp(path.join(dir, "atomic-"));
  await writeRequestAtomic(sub, request(0));
  await writeRequestAtomic(sub, { ...request(0), version: "0.12.0" });
  const files = await fs.readdir(sub);
  assert.deepEqual(files, ["request.json"], "no temporary files left behind");
  const snap = await readFolder(sub);
  assert.equal(snap.request?.version, "0.12.0");
  await assert.rejects(writeRequestAtomic(path.join(sub, "missing"), request(0)));
  assert.deepEqual(await fs.readdir(sub), ["request.json"]);
});

test("the log tail is capped, starts on a whole line and has no colour codes", async () => {
  await put("upgrade.log", `first line\n${"x".repeat(100)}\n\u001b[31mred\u001b[0m done\r\n`);
  assert.equal(await readLogTail(dir), `first line\n${"x".repeat(100)}\nred done\n`);
  const tail = await readLogTail(dir, 20);
  assert.equal(tail, "red done\n");
  await fs.rm(path.join(dir, "upgrade.log"));
  assert.equal(await readLogTail(dir), "");
});
