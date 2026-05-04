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
const mockListStaleBeats = vi.fn();

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

vi.mock("@/lib/stale-beat-grooming-list", () => ({
  listStaleBeatSummariesForApi: (
    ...args: unknown[]
  ) => mockListStaleBeats(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAssertAgent.mockResolvedValue({
    kind: "cli",
    command: "codex",
    agentId: "codex",
  });
  mockListStaleBeats.mockResolvedValue([]);
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

describe("stale beat grooming reviews GET", () => {
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
});

describe("stale beat grooming selected-target POST", () => {
  it("validates an override agent and enqueues canonical targets", async () => {
    const res = await POST(makeRequest({
      agentId: "codex",
      targets: [
        { beatId: "alias-id", repoPath: "/tmp/repo" },
      ],
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockAssertAgent).toHaveBeenCalledWith({
      agentId: "codex",
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
    });
    expect(json.data.jobs).toEqual([
      {
        jobId: "job-canonical-id",
        beatId: "canonical-id",
        repoPath: "/tmp/repo",
      },
    ]);
  });

  it("uses the dispatch default when no agent override is supplied", async () => {
    mockAssertAgent.mockResolvedValue({
      kind: "cli",
      command: "codex",
      agentId: "dispatch-default",
    });

    await POST(makeRequest({
      targets: [{ beatId: "raw-id" }],
    }));

    expect(mockAssertAgent).toHaveBeenCalledWith({
      agentId: undefined,
    });
    expect(mockEnqueue).toHaveBeenCalledWith({
      target: { beatId: "canonical-id" },
      agentId: "dispatch-default",
    });
  });
});

describe("stale beat grooming oldest-mode POST", () => {
  it("queues the oldest stale beats from API listing mode", async () => {
    mockListStaleBeats.mockResolvedValue([
      {
        beatId: "old-a",
        repoPath: "/repo",
      },
      {
        beatId: "old-b",
      },
    ]);

    const res = await POST(makeRequest({
      mode: "oldest",
      limit: 5,
      _repo: "/repo",
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockListStaleBeats).toHaveBeenCalledWith({
      repoPath: "/repo",
      scope: undefined,
      ageDays: 7,
      limit: 5,
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(json.data.jobs).toEqual([
      {
        jobId: "job-old-a",
        beatId: "old-a",
        repoPath: "/repo",
      },
      {
        jobId: "job-old-b",
        beatId: "old-b",
      },
    ]);
  });
});

describe("stale beat grooming fallback POST", () => {
  it("falls back to submitted beat id when canonical lookup misses", async () => {
    mockGet.mockResolvedValue({ ok: false, error: "missing" });

    await POST(makeRequest({
      agentId: "codex",
      targets: [{ beatId: "raw-id" }],
    }));

    expect(mockEnqueue).toHaveBeenCalledWith({
      target: { beatId: "raw-id" },
      agentId: "codex",
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
