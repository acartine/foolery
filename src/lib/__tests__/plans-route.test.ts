import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreatePlan = vi.fn();
const mockCompletePlanStep = vi.fn();
const mockFailPlanStep = vi.fn();
const mockListPlans = vi.fn();
const mockGetPlan = vi.fn();
const mockGetNextPlanStep = vi.fn();
const mockStartPlanStep = vi.fn();

vi.mock("@/lib/orchestration-plan-manager", () => ({
  completePlanStep: (...args: unknown[]) =>
    mockCompletePlanStep(...args),
  createPlan: (...args: unknown[]) => mockCreatePlan(...args),
  failPlanStep: (...args: unknown[]) =>
    mockFailPlanStep(...args),
  listPlans: (...args: unknown[]) => mockListPlans(...args),
  getPlan: (...args: unknown[]) => mockGetPlan(...args),
  getNextPlanStep: (...args: unknown[]) =>
    mockGetNextPlanStep(...args),
  startPlanStep: (...args: unknown[]) =>
    mockStartPlanStep(...args),
}));

import {
  GET as listPlansRoute,
  POST as createPlanRoute,
} from "@/app/api/plans/route";
import { GET as getPlanRoute } from "@/app/api/plans/[planId]/route";
import { GET as getNextPlanStepRoute } from "@/app/api/plans/[planId]/next/route";
import { POST as startPlanStepRoute } from "@/app/api/plans/[planId]/steps/[stepId]/start/route";
import { POST as completePlanStepRoute } from "@/app/api/plans/[planId]/steps/[stepId]/complete/route";
import { POST as failPlanStepRoute } from "@/app/api/plans/[planId]/steps/[stepId]/fail/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("plans routes create/list", () => {
  it("creates a persisted plan and returns its id", async () => {
    mockCreatePlan.mockResolvedValue({ planId: "plan-1" });

    const response = await createPlanRoute(
      new NextRequest("http://localhost/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: "/repo",
          objective: "Ship slice 1",
          mode: "groom",
          model: "gpt-5.4",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toEqual({ data: { planId: "plan-1" } });
    expect(mockCreatePlan).toHaveBeenCalledWith({
      repoPath: "/repo",
      objective: "Ship slice 1",
      mode: "groom",
      model: "gpt-5.4",
    });
  });

  it("lists persisted plans for a repo", async () => {
    mockListPlans.mockResolvedValue([
      {
        id: "plan-1",
        repoPath: "/repo",
        createdAt: "2026-04-14T00:00:00Z",
        updatedAt: "2026-04-14T00:00:00Z",
        status: "draft",
        summary: "Summary",
        waves: [],
        assumptions: [],
        unassignedBeatIds: [],
      },
    ]);

    const response = await listPlansRoute(
      new NextRequest(
        "http://localhost/api/plans?repoPath=/repo",
      ),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(mockListPlans).toHaveBeenCalledWith("/repo");
  });

  it("returns 400 when repoPath is missing on list", async () => {
    const response = await listPlansRoute(
      new NextRequest("http://localhost/api/plans"),
    );
    expect(response.status).toBe(400);
  });
});

describe("plans routes read/next", () => {
  it("returns one plan by id", async () => {
    mockGetPlan.mockResolvedValue({
      id: "plan-1",
      repoPath: "/repo",
      createdAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      status: "draft",
      summary: "Summary",
      waves: [],
      assumptions: [],
      unassignedBeatIds: [],
    });

    const response = await getPlanRoute(
      new NextRequest("http://localhost/api/plans/plan-1"),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.id).toBe("plan-1");
    expect(mockGetPlan).toHaveBeenCalledWith(
      "plan-1",
      undefined,
    );
  });

  it("returns 404 when the plan does not exist", async () => {
    mockGetPlan.mockResolvedValue(null);

    const response = await getPlanRoute(
      new NextRequest("http://localhost/api/plans/missing"),
      { params: Promise.resolve({ planId: "missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns the next executable step", async () => {
    mockGetNextPlanStep.mockResolvedValue({
      id: "step-1",
      title: "First",
      beatIds: ["beat-1"],
      status: "pending",
    });

    const response = await getNextPlanStepRoute(
      new NextRequest(
        "http://localhost/api/plans/plan-1/next?repoPath=/repo",
      ),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.id).toBe("step-1");
    expect(mockGetNextPlanStep).toHaveBeenCalledWith(
      "plan-1",
      "/repo",
    );
  });
});

describe("plans routes step start/complete", () => {
  it("starts a plan step and returns spawned beat sessions", async () => {
    mockStartPlanStep.mockResolvedValue({
      beats: [{ beatId: "beat-1", sessionId: "term-1" }],
    });

    const response = await startPlanStepRoute(
      new NextRequest(
        "http://localhost/api/plans/plan-1/steps/step-1/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath: "/repo" }),
        },
      ),
      {
        params: Promise.resolve({
          planId: "plan-1",
          stepId: "step-1",
        }),
      },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.beats).toEqual([
      { beatId: "beat-1", sessionId: "term-1" },
    ]);
    expect(mockStartPlanStep).toHaveBeenCalledWith(
      "plan-1",
      "step-1",
      "/repo",
    );
  });

  it("completes a plan step", async () => {
    mockCompletePlanStep.mockResolvedValue({
      stepId: "step-1",
      status: "complete",
    });

    const response = await completePlanStepRoute(
      new NextRequest(
        "http://localhost/api/plans/plan-1/steps/step-1/complete",
        { method: "POST" },
      ),
      {
        params: Promise.resolve({
          planId: "plan-1",
          stepId: "step-1",
        }),
      },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.status).toBe("complete");
    expect(mockCompletePlanStep).toHaveBeenCalledWith(
      "plan-1",
      "step-1",
      undefined,
    );
  });
});

describe("plans routes step failures", () => {
  it("fails a plan step with a reason", async () => {
    mockFailPlanStep.mockResolvedValue({
      stepId: "step-1",
      status: "failed",
    });

    const response = await failPlanStepRoute(
      new NextRequest(
        "http://localhost/api/plans/plan-1/steps/step-1/fail",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "blocked by fixture" }),
        },
      ),
      {
        params: Promise.resolve({
          planId: "plan-1",
          stepId: "step-1",
        }),
      },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.status).toBe("failed");
    expect(mockFailPlanStep).toHaveBeenCalledWith(
      "plan-1",
      "step-1",
      "blocked by fixture",
      undefined,
    );
  });

  it("maps plan-step state conflicts to HTTP 409", async () => {
    mockStartPlanStep.mockRejectedValue(
      new Error("Step step-1 is not pending."),
    );

    const response = await startPlanStepRoute(
      new NextRequest(
        "http://localhost/api/plans/plan-1/steps/step-1/start",
        { method: "POST" },
      ),
      {
        params: Promise.resolve({
          planId: "plan-1",
          stepId: "step-1",
        }),
      },
    );

    expect(response.status).toBe(409);
  });
});
