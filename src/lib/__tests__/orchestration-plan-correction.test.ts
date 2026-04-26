import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClose = vi.fn();
const mockGetPlan = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ close: mockClose }),
}));

vi.mock("@/lib/orchestration-plan-manager", () => ({
  getPlan: (...args: unknown[]) => mockGetPlan(...args),
}));

import { completePlan } from "@/lib/orchestration-plan-correction";

function makePlan(state: string, id = "plan-1") {
  return {
    artifact: {
      id,
      type: "execution_plan" as const,
      state,
      workflowId: "execution_plan_sdlc",
      createdAt: "2026-04-26T00:00:00Z",
      updatedAt: "2026-04-26T00:00:00Z",
    },
    plan: {
      repoPath: "/repo",
      beatIds: [],
      summary: "",
      waves: [],
      assumptions: [],
      unassignedBeatIds: [],
    },
    progress: {
      generatedAt: "2026-04-26T00:00:00Z",
      completionRule: "shipped" as const,
      beatStates: [],
      satisfiedBeatIds: [],
      remainingBeatIds: [],
      nextStep: null,
      waves: [],
    },
    lineage: { replacedByPlanIds: [] },
    skillPrompt: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("completePlan", () => {
  it("closes the plan via the backend and returns the refreshed record", async () => {
    mockGetPlan
      .mockResolvedValueOnce(makePlan("orchestration"))
      .mockResolvedValueOnce(makePlan("shipped"));
    mockClose.mockResolvedValue({ ok: true });

    const result = await completePlan("plan-1", "/repo");

    expect(mockClose).toHaveBeenCalledWith(
      "plan-1",
      "user_complete_plan",
      "/repo",
    );
    expect(mockGetPlan).toHaveBeenCalledTimes(2);
    expect(result.artifact.state).toBe("shipped");
  });

  it("throws when the plan is not found", async () => {
    mockGetPlan.mockResolvedValue(null);

    await expect(
      completePlan("missing", "/repo"),
    ).rejects.toThrow(/not found/i);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("throws when the plan is already in a terminal state", async () => {
    mockGetPlan.mockResolvedValueOnce(makePlan("shipped"));

    await expect(
      completePlan("plan-1", "/repo"),
    ).rejects.toThrow(/already complete/i);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("throws when the plan is already abandoned", async () => {
    mockGetPlan.mockResolvedValueOnce(makePlan("abandoned"));

    await expect(
      completePlan("plan-1", "/repo"),
    ).rejects.toThrow(/already complete/i);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("propagates backend close errors", async () => {
    mockGetPlan.mockResolvedValueOnce(makePlan("orchestration"));
    mockClose.mockResolvedValue({
      ok: false,
      error: {
        code: "CLOSE_FAILED",
        message: "kno close failed",
        retryable: false,
      },
    });

    await expect(
      completePlan("plan-1", "/repo"),
    ).rejects.toThrow("kno close failed");
  });
});
