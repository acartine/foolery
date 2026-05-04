import type { BdResult } from "@/lib/types";
import type {
  EnqueueStaleBeatGroomingResponse,
  StaleBeatGroomingOptions,
  StaleBeatGroomingReviewRecord,
  StaleBeatGroomingStatus,
  StaleBeatReviewRequest,
  StaleBeatSummary,
} from "@/lib/stale-beat-grooming-types";

const ROOT = "/api/beats/stale-grooming";
const REVIEWS = `${ROOT}/reviews`;

async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<BdResult<T>> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof json.error === "string"
        ? json.error
        : "Request failed",
    };
  }
  return { ok: true, data: (json.data ?? json) as T };
}

export function fetchStaleBeatGroomingReviews(): Promise<
  BdResult<StaleBeatGroomingReviewRecord[]>
> {
  return request<StaleBeatGroomingReviewRecord[]>(REVIEWS);
}

export function enqueueStaleBeatGroomingReviews(
  input: StaleBeatReviewRequest,
): Promise<BdResult<EnqueueStaleBeatGroomingResponse>> {
  return request<EnqueueStaleBeatGroomingResponse>(REVIEWS, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchStaleBeatGroomingOptions(): Promise<
  BdResult<StaleBeatGroomingOptions>
> {
  return request<StaleBeatGroomingOptions>(`${ROOT}/options`);
}

export function fetchStaleBeatGroomingStatus(): Promise<
  BdResult<StaleBeatGroomingStatus>
> {
  return request<StaleBeatGroomingStatus>(`${ROOT}/status`);
}

export function fetchStaleBeats(): Promise<
  BdResult<{ staleBeats: StaleBeatSummary[]; count: number }>
> {
  return request<{ staleBeats: StaleBeatSummary[]; count: number }>(ROOT);
}
