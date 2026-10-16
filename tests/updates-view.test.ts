import { test } from "node:test";
import assert from "node:assert/strict";
import { FAST_POLL_MS, SLOW_POLL_MS, describeUpgrade } from "../lib/updates/view-model";
import type { DerivedUpgrade, UpdateStatus } from "../lib/updates/types";

const idle: DerivedUpgrade = {
  state: "idle", id: "", from_version: "", to_version: "", requested_by: "", requested_at: "",
  started_at: "", finished_at: "", message: "", in_progress: false,
};
function status(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    current_version: "0.10.0",
    source_url: "",
    check_enabled: true,
    latest: { version: "0.11.0", tag: "v0.11.0", name: "", notes: "", url: "", published_at: "" },
    update_available: true,
    checked_at: "",
    check_error: "",
    helper: { folder_available: true, configured: true, connected: true, last_seen: "", every_minutes: 15 },
    upgrade: idle,
    can_upgrade: true,
    log: "",
    ...over,
  };
}

test("no update", () => {
  const v = describeUpgrade(status({ update_available: false, can_upgrade: false }));
  assert.equal(v.headline, "Francine is up to date");
  assert.equal(v.showUpgradeButton, false);
  assert.equal(v.pollMs, SLOW_POLL_MS);
  assert.equal(describeUpgrade(status({ latest: null, update_available: false, can_upgrade: false })).headline,
    "No releases have been published yet");
});

test("update available with the helper connected", () => {
  const v = describeUpgrade(status());
  assert.equal(v.headline, "Version 0.11.0 is available");
  assert.equal(v.showUpgradeButton, true);
  assert.match(v.detail, /about a minute/);
});

test("update available without the helper", () => {
  const notSetUp = describeUpgrade(status({ can_upgrade: false, helper: { ...status().helper, configured: false, connected: false } }));
  assert.equal(notSetUp.showUpgradeButton, false);
  assert.match(notSetUp.detail, /set up the server helper/);
  const disconnected = describeUpgrade(status({ can_upgrade: false, helper: { ...status().helper, connected: false } }));
  assert.equal(disconnected.tone, "warning");
  assert.match(disconnected.detail, /isn't connected/);
});

test("requested: uses the helper's own interval and polls quickly", () => {
  const upgrade = { ...idle, state: "requested" as const, to_version: "0.11.0", in_progress: true };
  const v = describeUpgrade(status({ can_upgrade: false, upgrade, helper: { ...status().helper, every_minutes: 5 } }));
  assert.equal(v.headline, "Upgrade to 0.11.0 requested");
  assert.equal(v.detail, "The helper starts it at its next check (up to 5 minutes).");
  assert.equal(v.warning, "");
  assert.equal(v.pollMs, FAST_POLL_MS);
  assert.equal(describeUpgrade(status({ upgrade, helper: { ...status().helper, every_minutes: 1 } })).detail,
    "The helper starts it at its next check (up to 1 minute).");
  const waiting = describeUpgrade(status({ upgrade, helper: { ...status().helper, connected: false } }));
  assert.match(waiting.warning, /may not be picked up/);
});

test("running, restarting, succeeded and failed", () => {
  const running = describeUpgrade(status({ can_upgrade: false, upgrade: { ...idle, state: "running", to_version: "0.11.0", in_progress: true } }));
  assert.equal(running.headline, "Upgrading to 0.11.0");
  assert.equal(running.pollMs, FAST_POLL_MS);

  const restarting = describeUpgrade(status(), { unreachable: true });
  assert.equal(restarting.headline, "Francine is restarting");
  assert.equal(restarting.showUpgradeButton, false);
  assert.equal(restarting.pollMs, FAST_POLL_MS);

  const done = describeUpgrade(status({
    current_version: "0.11.0", update_available: false, can_upgrade: false,
    upgrade: { ...idle, state: "succeeded", to_version: "0.11.0" },
  }));
  assert.equal(done.tone, "success");
  assert.equal(done.showReload, true);
  assert.match(done.detail, /Reload the page/);
  assert.equal(done.pollMs, SLOW_POLL_MS);

  const failed = describeUpgrade(status({ upgrade: { ...idle, state: "failed", to_version: "0.11.0", message: "Francine 0.10.0 is still running." } }));
  assert.equal(failed.tone, "error");
  assert.equal(failed.detail, "Francine 0.10.0 is still running.");
  assert.equal(failed.showUpgradeButton, true, "a failed upgrade can be tried again");
});
