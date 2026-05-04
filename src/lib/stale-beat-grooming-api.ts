import type { BdResult } from "@/lib/types";
import type {
  EnqueueStaleBeatGroomingResponse,
  StaleBeatGroomingReviewRecord,
  StaleBeatReviewRequest,
} from "@/lib/stale-beat-grooming-types";

const BASE = "/api/beats/stale-grooming/reviews";

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
  return request<StaleBeatGroomingReviewRecord[]>(BASE);
}

export function enqueueStaleBeatGroomingReviews(
  input: StaleBeatReviewRequest,
): Promise<BdResult<EnqueueStaleBeatGroomingResponse>> {
  return request<EnqueueStaleBeatGroomingResponse>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
