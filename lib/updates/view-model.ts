// What the Updates page shows for a given status. Pure and browser-safe.

import type { UpdateStatus } from "./types";

export const FAST_POLL_MS = 3_000;
export const SLOW_POLL_MS = 60_000;

export type Tone = "info" | "success" | "warning" | "error";

export interface UpgradeView {
  headline: string;
  detail: string;
  tone: Tone;
  showUpgradeButton: boolean;
  showReload: boolean;
  warning: string;
  pollMs: number;
}

export function minutesLabel(n: number): string {
  return n === 1 ? "1 minute" : `${n} minutes`;
}

export function describeUpgrade(status: UpdateStatus, opts: { unreachable?: boolean } = {}): UpgradeView {
  const { upgrade, helper, latest } = status;
  const view: UpgradeView = {
    headline: "",
    detail: "",
    tone: "info",
    showUpgradeButton: status.can_upgrade,
    showReload: false,
    warning: "",
    pollMs: upgrade.in_progress ? FAST_POLL_MS : SLOW_POLL_MS,
  };

  if (opts.unreachable) {
    return {
      ...view,
      headline: "Francine is restarting",
      detail: "This page will reconnect on its own.",
      showUpgradeButton: false,
      pollMs: FAST_POLL_MS,
    };
  }

  switch (upgrade.state) {
    case "requested":
      view.headline = `Upgrade to ${upgrade.to_version} requested`;
      view.detail = `The helper starts it at its next check (up to ${minutesLabel(helper.every_minutes)}).`;
      if (!helper.connected) {
        view.warning = "The server helper hasn't checked in recently, so this request may not be picked up.";
      }
      return view;
    case "running":
      view.headline = `Upgrading to ${upgrade.to_version}`;
      view.detail = "Francine will be unavailable for about a minute while it restarts.";
      return view;
    case "succeeded":
      view.tone = "success";
      view.headline = `Upgraded to ${upgrade.to_version}`;
      view.detail = upgrade.to_version === status.current_version
        ? "Reload the page to use the new version."
        : "Reload the page once Francine has restarted.";
      view.showReload = true;
      return view;
    case "failed":
      view.tone = "error";
      view.headline = upgrade.to_version ? `The upgrade to ${upgrade.to_version} didn't finish` : "The upgrade didn't finish";
      view.detail = upgrade.message || "See the upgrade log for details.";
      return view;
    default:
      break;
  }

  if (status.update_available && latest) {
    view.headline = `Version ${latest.version} is available`;
    if (!helper.configured) {
      view.detail = "To upgrade from here, set up the server helper below, or upgrade from the terminal.";
    } else if (!helper.connected) {
      view.tone = "warning";
      view.detail = "The server helper isn't connected, so the upgrade button is turned off.";
    } else {
      view.detail = "Francine will be unavailable for about a minute while it restarts.";
    }
    return view;
  }

  view.tone = "success";
  view.headline = latest ? "Francine is up to date" : "No releases have been published yet";
  return view;
}
