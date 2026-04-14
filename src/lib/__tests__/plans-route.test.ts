import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreatePlan = vi.fn();
const mockListPlans = vi.fn();
const mockGetPlan = vi.fn();

vi.mock("@/lib/orchestration-plan-manager", () => ({
  createPlan: (...args: unknown[]) => mockCreatePlan(...args),
  listPlans: (...args: unknown[]) => mockListPlans(...args),
  getPlan: (...args: unknown[]) => mockGetPlan(...args),
}));

import {
  GET as listPlansRoute,
  POST as createPlanRoute,
} from "@/app/api/plans/route";
import { GET as getPlanRoute } from "@/app/api/plans/[planId]/route";

function makePersistedPlan(id = "plan-1") {
  return {
    artifact: {
      id,
      type: "execution_plan" as const,
      state: "design",
      workflowId: "execution_plan_sdlc",
      createdAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
    },
    plan: {
      repoPath: "/repo",
      beatIds: ["beat-1"],
      objective: "Ship slice 1",
      summary: "Summary",
      waves: [],
      assumptions: [],
      unassignedBeatIds: [],
    },
    progress: {
      generatedAt: "2026-04-14T00:00:00Z",
      completionRule: "shipped" as const,
      beatStates: [],
      satisfiedBeatIds: [],
      remainingBeatIds: ["beat-1"],
      nextStep: null,
      waves: [],
    },
    lineage: {
      replacedByPlanIds: [],
    },
    skillPrompt: "# Execution Plan Skill\n\n## Purpose\n- Repo: /repo",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("plans routes create/list", () => {
  it("creates a persisted plan and returns the full record", async () => {
    mockCreatePlan.mockResolvedValue({
      planId: "repo-plan-1",
    });
    mockGetPlan.mockResolvedValue(
      makePersistedPlan("repo-plan-1"),
    );

    const response = await createPlanRoute(
      new NextRequest("http://localhost/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: "/repo",
          beatIds: ["beat-1", "beat-2"],
          objective: "Ship slice 1",
          mode: "groom",
          model: "gpt-5.4",
          replacesPlanId: "plan-0",
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.data.artifact.id).toBe("repo-plan-1");
    expect(json.data.skillPrompt).toContain(
      "Execution Plan Skill",
    );
    expect(mockCreatePlan).toHaveBeenCalledWith({
      repoPath: "/repo",
      beatIds: ["beat-1", "beat-2"],
      objective: "Ship slice 1",
      mode: "groom",
      model: "gpt-5.4",
      replacesPlanId: "plan-0",
    });
    expect(mockGetPlan).toHaveBeenCalledWith(
      "repo-plan-1",
      "/repo",
    );
  });

  it("returns 400 when beatIds is missing on create", async () => {
    const response = await createPlanRoute(
      new NextRequest("http://localhost/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: "/repo" }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("lists persisted plans for a repo", async () => {
    mockListPlans.mockResolvedValue([
      {
        artifact: {
          id: "plan-1",
          type: "execution_plan",
          state: "design",
          workflowId: "execution_plan_sdlc",
          createdAt: "2026-04-14T00:00:00Z",
          updatedAt: "2026-04-14T00:00:00Z",
        },
        plan: {
          repoPath: "/repo",
          beatIds: ["beat-1", "beat-2"],
          objective: "Ship slice 1",
          summary: "Summary",
          mode: "groom",
          model: "gpt-5.4",
        },
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

describe("plans routes read", () => {
  it("returns one plan by id", async () => {
    mockGetPlan.mockResolvedValue(makePersistedPlan());

    const response = await getPlanRoute(
      new NextRequest("http://localhost/api/plans/plan-1"),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.artifact.id).toBe("plan-1");
    expect(json.data.skillPrompt).toContain("Execution Plan Skill");
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

  it("passes repoPath through when provided on read", async () => {
    mockGetPlan.mockResolvedValue(
      makePersistedPlan("repo-plan-1"),
    );

    const response = await getPlanRoute(
      new NextRequest(
        "http://localhost/api/plans/repo-plan-1?repoPath=/repo",
      ),
      {
        params: Promise.resolve({
          planId: "repo-plan-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mockGetPlan).toHaveBeenCalledWith(
      "repo-plan-1",
      "/repo",
    );
  });
});
