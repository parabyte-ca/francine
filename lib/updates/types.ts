// Shared shapes for the in-app update feature. No runtime imports so the
// client page can use these types without pulling in Node modules.

export interface Release {
  version: string;      // normalised, e.g. "1.2.3"
  tag: string;          // as published, e.g. "v1.2.3"
  name: string;
  notes: string;        // Markdown, capped
  url: string;          // https://github.com/... release page, or ""
  published_at: string; // ISO-8601, or ""
}

export interface UpdateCache {
  release: Release | null;
  checked_at: string;   // ISO-8601
  check_error: string;  // "" when the last check succeeded
  notified_event_id: string;
}

export interface UpgradeRequest {
  id: string;
  version: string;
  requested_by: string;
  requested_at: string;
}

export interface AgentHeartbeat {
  last_seen: string;
  every_minutes: number;
}

export type HelperRunState = "running" | "succeeded" | "failed";

export interface UpgradeStatusFile {
  id: string;
  state: HelperRunState;
  from_version: string;
  to_version: string;
  requested_by: string;
  started_at: string;
  finished_at: string;
  message: string;
}

export type UpgradeState = "idle" | "requested" | "running" | "succeeded" | "failed";

export interface DerivedUpgrade {
  state: UpgradeState;
  id: string;
  from_version: string;
  to_version: string;
  requested_by: string;
  requested_at: string;
  started_at: string;
  finished_at: string;
  message: string;
  in_progress: boolean;
}

export interface HelperStatus {
  folder_available: boolean;
  configured: boolean;
  connected: boolean;
  last_seen: string;
  every_minutes: number;
}

export interface UpdateStatus {
  current_version: string;
  source_url: string;
  check_enabled: boolean;
  latest: Release | null;
  update_available: boolean;
  checked_at: string;
  check_error: string;
  helper: HelperStatus;
  upgrade: DerivedUpgrade;
  can_upgrade: boolean;
  log: string;
}
