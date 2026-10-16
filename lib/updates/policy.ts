// Rules for who may request an upgrade and when. Pure so they can be tested.

import { isNewer, normaliseVersion } from "./semver";
import type { Release } from "./types";

export type Refusal = { ok: false; status: number; error: string };

/**
 * Francine has a single trust tier: everyone in ALLOWED_EMAILS is an owner.
 * An upgrade still needs a signed-in browser session — never a bearer token —
 * and a same-origin request so another site can't trigger one.
 */
export function checkUpgradeCaller(input: {
  sessionEmail: string | null;
  hasAuthorizationHeader: boolean;
  sameOrigin: boolean;
}): { ok: true } | Refusal {
  if (input.hasAuthorizationHeader) {
    return { ok: false, status: 403, error: "Upgrades can only be requested from a signed-in browser session, not with a token." };
  }
  if (!input.sessionEmail) {
    return { ok: false, status: 401, error: "Sign in to request an upgrade." };
  }
  if (!input.sameOrigin) {
    return { ok: false, status: 403, error: "This request didn't come from the Francine app." };
  }
  return { ok: true };
}

export function evaluateUpgradeRequest(input: {
  requestedVersion: unknown;
  currentVersion: string;
  latest: Release | null;
  helperConnected: boolean;
  inProgress: boolean;
}): { ok: true; version: string } | Refusal {
  const version = normaliseVersion(input.requestedVersion);
  if (!version) return { ok: false, status: 400, error: "That isn't a version like 1.2.3." };
  if (!input.latest) {
    return { ok: false, status: 409, error: "No release is known yet. Use “Check now” first." };
  }
  if (version !== input.latest.version) {
    return { ok: false, status: 409, error: `Only the latest release (${input.latest.version}) can be installed.` };
  }
  if (!isNewer(version, input.currentVersion)) {
    return { ok: false, status: 409, error: `Francine is already running ${input.currentVersion}.` };
  }
  if (input.inProgress) {
    return { ok: false, status: 409, error: "An upgrade is already requested or running." };
  }
  if (!input.helperConnected) {
    return { ok: false, status: 409, error: "The server helper isn't connected, so the upgrade can't start." };
  }
  return { ok: true, version };
}

export function computeCanUpgrade(input: {
  updateAvailable: boolean;
  helperConnected: boolean;
  inProgress: boolean;
}): boolean {
  return input.updateAvailable && input.helperConnected && !input.inProgress;
}
