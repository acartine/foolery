import { describe, expect, it } from "vitest";
import {
  canTakeAfterGrooming,
  deriveGroomingStatus,
  isGroomingTerminal,
  type GroomingActionStatus,
} from "@/lib/grooming-status";
import type {
  StaleBeatGroomingReviewRecord,
  StaleBeatReviewStatus,
} from "@/lib/stale-beat-grooming-types";

function review(
  jobId: string,
  status: StaleBeatReviewStatus,
  error?: string,
): StaleBeatGroomingReviewRecord {
  return {
    key: jobId,
    jobId,
    beatId: "foolery-1",
    status,
    queuedAt: 1,
    agentId: "codex",
    ...(error ? { error } : {}),
  };
}

describe("deriveGroomingStatus", () => {
  it("returns idle before a job has a matching review record", () => {
    expect(deriveGroomingStatus([], null)).toEqual({
      status: "idle",
    });
    expect(
      deriveGroomingStatus([review("other", "queued")], "job-1"),
    ).toEqual({ status: "idle" });
  });

  it("reports queued, running, and completed review states", () => {
    expect(
      deriveGroomingStatus([review("job-1", "queued")], "job-1"),
    ).toEqual({ status: "queued" });
    expect(
      deriveGroomingStatus([review("job-1", "running")], "job-1"),
    ).toEqual({ status: "running" });
    expect(
      deriveGroomingStatus([review("job-1", "completed")], "job-1"),
    ).toEqual({ status: "completed" });
  });

  it("surfaces failed review errors", () => {
    expect(
      deriveGroomingStatus(
        [review("job-1", "failed", "agent unavailable")],
        "job-1",
      ),
    ).toEqual({
      status: "failed",
      error: "agent unavailable",
    });
  });
});

describe("grooming action gates", () => {
  it("allows Take only after grooming completed successfully", () => {
    const statuses: GroomingActionStatus[] = [
      "idle",
      "queued",
      "running",
      "failed",
      "completed",
    ];
    expect(statuses.map(canTakeAfterGrooming)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("treats completed and failed grooming states as terminal", () => {
    expect(isGroomingTerminal("completed")).toBe(true);
    expect(isGroomingTerminal("failed")).toBe(true);
    expect(isGroomingTerminal("running")).toBe(false);
  });
});
