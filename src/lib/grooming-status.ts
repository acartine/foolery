import type {
  StaleBeatGroomingReviewRecord,
  StaleBeatReviewStatus,
} from "@/lib/stale-beat-grooming-types";

export type GroomingActionStatus =
  | "idle"
  | StaleBeatReviewStatus;

export interface GroomingActionState {
  status: GroomingActionStatus;
  error?: string;
}

export function deriveGroomingStatus(
  records: StaleBeatGroomingReviewRecord[],
  jobId: string | null | undefined,
): GroomingActionState {
  if (!jobId) return { status: "idle" };
  const record = records.find((item) => item.jobId === jobId);
  if (!record) return { status: "idle" };
  if (record.status !== "failed") {
    return { status: record.status };
  }
  return {
    status: "failed",
    error: record.error ?? "Grooming failed",
  };
}

export function isGroomingTerminal(
  status: GroomingActionStatus,
): boolean {
  return status === "completed" || status === "failed";
}

export function canTakeAfterGrooming(
  status: GroomingActionStatus,
): boolean {
  return status === "completed";
}
