import type { BeatsSyncState } from "@/lib/beats-sync-state";
import type { BdResult } from "@/lib/types";

const SYNC_BEATS_BASE = "/api/sync/beats";

async function request(options?: RequestInit): Promise<BdResult<BeatsSyncState>> {
  const res = await fetch(SYNC_BEATS_BASE, options);
  const json = await res.json();
  if (!res.ok) return { ok: false, error: json.error ?? "Request failed" };
  return { ok: true, data: json };
}

export function fetchSyncState(): Promise<BdResult<BeatsSyncState>> {
  return request();
}

export function triggerSyncRun(): Promise<BdResult<BeatsSyncState>> {
  return request({ method: "POST" });
}
