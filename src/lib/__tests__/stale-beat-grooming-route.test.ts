import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

const mockGet = vi.fn();
const mockAssertAgent = vi.fn();
const mockEnqueue = vi.fn();
const mockListReviews = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ get: mockGet }),
}));

vi.mock("@/lib/stale-beat-grooming-agent", () => ({
  assertStaleBeatGroomingAgent: (
    ...args: unknown[]
  ) => mockAssertAgent(...args),
  StaleBeatGroomingFailureError: class extends Error {
    status = 400;
  },
}));

vi.mock("@/lib/stale-beat-grooming-store", () => ({
  listStaleBeatGroomingReviews: () => mockListReviews(),
}));

vi.mock("@/lib/stale-beat-grooming-worker", () => ({
  enqueueStaleBeatGroomingReview: (
    ...args: unknown[]
  ) => mockEnqueue(...args),
}));

import {
  GET,
  POST,
} from "@/app/api/beats/stale-grooming/reviews/route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    "http://localhost/api/beats/stale-grooming/reviews",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("stale beat grooming reviews route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAgent.mockResolvedValue(undefined);
    mockGet.mockResolvedValue({
      ok: true,
      data: { id: "canonical-id" },
    });
    mockEnqueue.mockImplementation(
      (input: {
        target: { beatId: string; repoPath?: string };
      }) => ({
        id: `job-${input.target.beatId}`,
        beatId: input.target.beatId,
        ...(input.target.repoPath
          ? { repoPath: input.target.repoPath }
          : {}),
      }),
    );
  });

  it("returns existing review records", async () => {
    mockListReviews.mockReturnValue([
      { key: "::b1", beatId: "b1", status: "completed" },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([
      { key: "::b1", beatId: "b1", status: "completed" },
    ]);
  });

  it("validates the selected agent and enqueues canonical targets", async () => {
    const res = await POST(makeRequest({
      agentId: "codex",
      modelOverride: "gpt-5.5",
      targets: [
        { beatId: "alias-id", repoPath: "/tmp/repo" },
      ],
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockAssertAgent).toHaveBeenCalledWith({
      agentId: "codex",
      modelOverride: "gpt-5.5",
    });
    expect(mockGet).toHaveBeenCalledWith(
      "alias-id",
      "/tmp/repo",
    );
    expect(mockEnqueue).toHaveBeenCalledWith({
      target: {
        beatId: "canonical-id",
        repoPath: "/tmp/repo",
      },
      agentId: "codex",
      modelOverride: "gpt-5.5",
    });
    expect(json.data.jobs).toEqual([
      {
        jobId: "job-canonical-id",
        beatId: "canonical-id",
        repoPath: "/tmp/repo",
      },
    ]);
  });

  it("falls back to submitted beat id when canonical lookup misses", async () => {
    mockGet.mockResolvedValue({ ok: false, error: "missing" });

    await POST(makeRequest({
      agentId: "codex",
      targets: [{ beatId: "raw-id" }],
    }));

    expect(mockEnqueue).toHaveBeenCalledWith({
      target: { beatId: "raw-id" },
      agentId: "codex",
      modelOverride: undefined,
    });
  });

  it("surfaces selected-agent failures", async () => {
    mockAssertAgent.mockRejectedValue(
      new Error("FOOLERY GROOMING FAILURE: missing agent"),
    );

    const res = await POST(makeRequest({
      agentId: "missing",
      targets: [{ beatId: "b1" }],
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("FOOLERY GROOMING FAILURE");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
