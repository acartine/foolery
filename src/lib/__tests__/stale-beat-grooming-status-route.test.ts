import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQueueSize = vi.fn();
const mockListReviews = vi.fn();
const mockStartWorker = vi.fn();
const mockGetHealth = vi.fn();

vi.mock("@/lib/stale-beat-grooming-queue", () => ({
  getStaleBeatGroomingQueueSize: () => mockGetQueueSize(),
}));

vi.mock("@/lib/stale-beat-grooming-store", () => ({
  listStaleBeatGroomingReviews: () => mockListReviews(),
}));

vi.mock("@/lib/stale-beat-grooming-worker", () => ({
  startStaleBeatGroomingWorker: () => mockStartWorker(),
  getStaleBeatGroomingWorkerHealth: () => mockGetHealth(),
}));

import { GET } from "@/app/api/beats/stale-grooming/status/route";

describe("GET /api/beats/stale-grooming/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQueueSize.mockReturnValue(2);
    mockListReviews.mockReturnValue([
      { key: "::b1", beatId: "b1", status: "queued" },
    ]);
    mockGetHealth.mockReturnValue({
      workerCount: 1,
      activeJobs: [{ jobId: "job-1", beatId: "b1", startedAt: 1 }],
      totalCompleted: 3,
      totalFailed: 1,
      recentFailures: [],
      recentCompletions: [],
      uptimeMs: 100,
    });
  });

  it("returns queue, review, and worker health data", async () => {
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockStartWorker).toHaveBeenCalledTimes(1);
    expect(json).toEqual({
      ok: true,
      data: {
        queueSize: 2,
        reviews: [
          { key: "::b1", beatId: "b1", status: "queued" },
        ],
        worker: {
          workerCount: 1,
          activeJobs: [
            { jobId: "job-1", beatId: "b1", startedAt: 1 },
          ],
          totalCompleted: 3,
          totalFailed: 1,
          recentFailures: [],
          recentCompletions: [],
          uptimeMs: 100,
        },
      },
    });
  });
});
