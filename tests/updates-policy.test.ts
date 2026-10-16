import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpgradeCaller, computeCanUpgrade, evaluateUpgradeRequest } from "../lib/updates/policy";
import type { Release } from "../lib/updates/types";

const latest: Release = { version: "0.11.0", tag: "v0.11.0", name: "", notes: "", url: "", published_at: "" };
const ok = { requestedVersion: "0.11.0", currentVersion: "0.10.0", latest, helperConnected: true, inProgress: false };

test("only a signed-in browser session on Francine's own origin may upgrade", () => {
  assert.deepEqual(checkUpgradeCaller({ sessionEmail: "owner@example.ca", hasAuthorizationHeader: false, sameOrigin: true }), { ok: true });
  const token = checkUpgradeCaller({ sessionEmail: "owner@example.ca", hasAuthorizationHeader: true, sameOrigin: true });
  assert.equal(token.ok, false);
  assert.equal(!token.ok && token.status, 403);
  const anonymous = checkUpgradeCaller({ sessionEmail: null, hasAuthorizationHeader: false, sameOrigin: true });
  assert.equal(!anonymous.ok && anonymous.status, 401);
  const crossSite = checkUpgradeCaller({ sessionEmail: "owner@example.ca", hasAuthorizationHeader: false, sameOrigin: false });
  assert.equal(!crossSite.ok && crossSite.status, 403);
});

test("the latest, newer release is accepted", () => {
  assert.deepEqual(evaluateUpgradeRequest(ok), { ok: true, version: "0.11.0" });
  assert.deepEqual(evaluateUpgradeRequest({ ...ok, requestedVersion: "v0.11.0" }), { ok: true, version: "0.11.0" });
});

test("stale, non-latest or odd versions are refused", () => {
  const refusals: [string, Parameters<typeof evaluateUpgradeRequest>[0], RegExp][] = [
    ["not the latest", { ...ok, requestedVersion: "0.10.5" }, /Only the latest release/],
    ["older than running", { ...ok, latest: { ...latest, version: "0.9.0" }, requestedVersion: "0.9.0" }, /already running/],
    ["same as running", { ...ok, currentVersion: "0.11.0" }, /already running/],
    ["not a version", { ...ok, requestedVersion: "0.11.0; rm -rf /" }, /isn't a version/],
    ["missing", { ...ok, requestedVersion: undefined }, /isn't a version/],
    ["no release known", { ...ok, latest: null }, /No release is known/],
    ["already in progress", { ...ok, inProgress: true }, /already requested or running/],
    ["helper not connected", { ...ok, helperConnected: false }, /helper isn't connected/],
  ];
  for (const [label, input, message] of refusals) {
    const r = evaluateUpgradeRequest(input);
    assert.equal(r.ok, false, label);
    assert.match(!r.ok ? r.error : "", message, label);
  }
});

test("can_upgrade needs an update, a connected helper and nothing in progress", () => {
  assert.equal(computeCanUpgrade({ updateAvailable: true, helperConnected: true, inProgress: false }), true);
  assert.equal(computeCanUpgrade({ updateAvailable: false, helperConnected: true, inProgress: false }), false);
  assert.equal(computeCanUpgrade({ updateAvailable: true, helperConnected: false, inProgress: false }), false);
  assert.equal(computeCanUpgrade({ updateAvailable: true, helperConnected: true, inProgress: true }), false);
});
