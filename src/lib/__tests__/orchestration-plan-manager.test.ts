import { readFile } from "node:fs/promises";

import { beforeEach, expect, it, vi } from "vitest";
import type { OrchestrationPlan } from "@/lib/types";

const mockAddEdge = vi.fn();
const mockBackendGet = vi.fn();
const mockGenerateExecutionPlan = vi.fn();
const mockListEdges = vi.fn();
const mockListKnots = vi.fn();
const mockListRepos = vi.fn();
const mockNewKnot = vi.fn();
const mockRemoveEdge = vi.fn();
const mockShowKnot = vi.fn();
const mockUpdateKnot = vi.fn();

vi.mock("@/lib/knots", () => ({
  addEdge: (...args: unknown[]) => mockAddEdge(...args),
  listEdges: (...args: unknown[]) => mockListEdges(...args),
  listKnots: (...args: unknown[]) => mockListKnots(...args),
  newKnot: (...args: unknown[]) => mockNewKnot(...args),
  removeEdge: (...args: unknown[]) => mockRemoveEdge(...args),
  showKnot: (...args: unknown[]) => mockShowKnot(...args),
  updateKnot: (...args: unknown[]) => mockUpdateKnot(...args),
}));

vi.mock("@/lib/orchestration-plan-generation", () => ({
  generateExecutionPlan: (...args: unknown[]) =>
    mockGenerateExecutionPlan(...args),
}));

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ get: mockBackendGet }),
}));

vi.mock("@/lib/registry", () => ({
  listRepos: (...args: unknown[]) => mockListRepos(...args),
}));

import {
  createPlan,
  getPlan,
  listPlans,
} from "@/lib/orchestration-plan-manager";

const CREATED_PLAN: OrchestrationPlan = {
  summary: "Summary",
  waves: [
    {
      waveIndex: 1,
      name: "Wave 1",
      objective: "Do work",
      agents: [],
      beats: [
        { id: "beat-1", title: "Beat 1" },
        { id: "beat-2", title: "Beat 2" },
      ],
      steps: [
        {
          stepIndex: 1,
          beatIds: ["beat-1", "beat-2"],
          notes: "Keep these together.",
        },
      ],
    },
  ],
  unassignedBeatIds: ["beat-3"],
  assumptions: ["One"],
};

function makePlanKnot(
  plan: Record<string, unknown>,
  id = "plan-1",
) {
  return {
    ok: true,
    data: {
      id,
      type: "execution_plan",
      state: "design",
      workflow_id: "execution_plan_sdlc",
      created_at: "2026-04-14T00:00:00Z",
      updated_at: "2026-04-14T01:00:00Z",
      execution_plan: plan,
    },
  };
}

function mockReplacedPlan() {
  mockShowKnot.mockResolvedValue({
    ok: true,
    data: {
      id: "plan-0",
      type: "execution_plan",
      state: "design",
      updated_at: "2026-04-14T00:00:00Z",
    },
  });
}

function expectPersistedExecutionPlan(
  input: { executionPlanFile?: string },
) {
  const filePath = input.executionPlanFile;
  expect(filePath).toBeTruthy();
  return readFile(filePath!, "utf8").then((raw) => {
    const parsed = JSON.parse(raw);
    expect(parsed.repo_path).toBe("/repo");
    expect(parsed.beat_ids).toEqual(["beat-1", "beat-2"]);
    expect(parsed.unassigned_beat_ids).toEqual(["beat-3"]);
    expect(parsed.waves[0]?.steps[0]).toEqual({
      step_index: 1,
      beat_ids: ["beat-1", "beat-2"],
      notes: "Keep these together.",
    });
  });
}

function mockLineageEdges() {
  mockListEdges.mockImplementation(
    async (
      _id: string,
      direction: "incoming" | "outgoing" | "both",
    ) => ({
      ok: true,
      data:
        direction === "incoming"
          ? [{ src: "plan-2", kind: "replaces", dst: "plan-1" }]
          : [{ src: "plan-1", kind: "replaces", dst: "plan-0" }],
    }),
  );
}

function mockLiveBeatStates() {
  mockBackendGet
    .mockResolvedValueOnce({
      ok: true,
      data: { id: "beat-1", title: "Beat 1", state: "shipped" },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: { id: "beat-2", title: "Beat 2", state: "in_progress" },
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListEdges.mockResolvedValue({ ok: true, data: [] });
  mockListRepos.mockResolvedValue([]);
  mockAddEdge.mockResolvedValue({ ok: true });
  mockRemoveEdge.mockResolvedValue({ ok: true });
});

it("creates a plan, persists execution_plan payload, and links beats", async () => {
  mockGenerateExecutionPlan.mockResolvedValue(CREATED_PLAN);
  mockNewKnot.mockResolvedValue({ ok: true, data: { id: "1234" } });
  mockReplacedPlan();
  mockUpdateKnot.mockImplementation(async (_id, input) => {
    await expectPersistedExecutionPlan(input);
    return { ok: true };
  });

  await expect(createPlan({
    repoPath: "/repo",
    beatIds: ["beat-1", "beat-2"],
    objective: "Ship it",
    mode: "groom",
    replacesPlanId: "plan-0",
  })).resolves.toEqual({
    planId: "repo-1234",
  });
  expect(mockGenerateExecutionPlan).toHaveBeenCalledWith({
    repoPath: "/repo",
    beatIds: ["beat-1", "beat-2"],
    objective: "Ship it",
    mode: "groom",
    replacesPlanId: "plan-0",
  });
  expect(mockNewKnot).toHaveBeenCalledWith(
    "Execution plan: Ship it",
    expect.objectContaining({ type: "execution_plan" }),
    "/repo",
  );
  expect(mockAddEdge).toHaveBeenCalledWith(
    "beat-1",
    "planned_by",
    "repo-1234",
    "/repo",
  );
  expect(mockAddEdge).toHaveBeenCalledWith(
    "beat-2",
    "planned_by",
    "repo-1234",
    "/repo",
  );
  expect(mockAddEdge).toHaveBeenCalledWith(
    "repo-1234",
    "replaces",
    "plan-0",
    "/repo",
  );
});

it("returns artifact, plan, progress, and lineage", async () => {
  mockShowKnot.mockResolvedValue(
    makePlanKnot({
      repo_path: "/repo",
      beat_ids: ["beat-1", "beat-2"],
      summary: "Summary",
      waves: [
        {
          wave_index: 1,
          name: "Wave 1",
          objective: "Do work",
          agents: [],
          beats: [{ id: "beat-1", title: "Beat 1" }],
          steps: [
            {
              step_index: 1,
              beat_ids: ["beat-1"],
            },
            {
              step_index: 2,
              beat_ids: ["beat-2"],
            },
          ],
        },
      ],
      assumptions: [],
      unassigned_beat_ids: [],
    }),
  );
  mockLineageEdges();
  mockLiveBeatStates();

  const plan = await getPlan("plan-1", "/repo");
  expect(plan).not.toBeNull();
  expect(plan?.artifact).toMatchObject({
    id: "plan-1",
    type: "execution_plan",
    state: "design",
  });
  expect(plan?.plan.beatIds).toEqual(["beat-1", "beat-2"]);
  expect(plan?.progress.satisfiedBeatIds).toEqual(["beat-1"]);
  expect(plan?.progress.remainingBeatIds).toEqual(["beat-2"]);
  expect(plan?.progress.nextStep).toEqual({
    waveIndex: 1,
    stepIndex: 2,
    beatIds: ["beat-2"],
    notes: undefined,
  });
  expect(plan?.lineage).toEqual({
    replacesPlanId: "plan-0",
    replacedByPlanIds: ["plan-2"],
  });
  expect(plan?.skillPrompt).toContain("# Execution Plan Skill");
  expect(plan?.skillPrompt).toContain(
    "- Step: a set of beats that may be executed in parallel.",
  );
  expect(plan?.skillPrompt).toContain(
    "POST /api/terminal",
  );
  expect(plan?.skillPrompt).toContain(
    "Wave 1, Step 2: `beat-2`",
  );
});

it("resolves a plan from the repo registry when repoPath is omitted", async () => {
  mockListRepos.mockResolvedValue([
    {
      path: "/repo",
      name: "repo",
      addedAt: "2026-04-14T00:00:00Z",
      memoryManagerType: "knots",
    },
    {
      path: "/other",
      name: "other",
      addedAt: "2026-04-14T00:00:00Z",
      memoryManagerType: "knots",
    },
  ]);
  mockShowKnot
    .mockResolvedValueOnce(
      makePlanKnot(
        {
          repo_path: "/repo",
          beat_ids: ["beat-1"],
          summary: "Summary",
          waves: [
            {
              wave_index: 1,
              name: "Wave 1",
              objective: "Do work",
              beats: [{ id: "beat-1", title: "Beat 1" }],
              steps: [
                {
                  step_index: 1,
                  beat_ids: ["beat-1"],
                },
              ],
            },
          ],
          assumptions: [],
          unassigned_beat_ids: [],
        },
        "repo-plan-1",
      ),
    )
    .mockResolvedValueOnce({
      ok: false,
      error:
        "error: workflow error: invalid workflow bundle: knot type 'execution_plan' has no registered workflows",
    });
  mockListEdges.mockResolvedValue({ ok: true, data: [] });
  mockBackendGet.mockResolvedValue({
    ok: true,
    data: { id: "beat-1", title: "Beat 1", state: "ready" },
  });

  const plan = await getPlan("repo-plan-1");

  expect(mockShowKnot).toHaveBeenCalledWith(
    "repo-plan-1",
    "/repo",
  );
  expect(mockShowKnot).toHaveBeenCalledTimes(1);
  expect(plan?.artifact.id).toBe("repo-plan-1");
});

it("lists repo-scoped plan knots even when legacy payloads omit repo_path", async () => {
  mockListKnots.mockResolvedValue({
    ok: true,
    data: [
      makePlanKnot(
        {
          repo_path: "/repo",
          beat_ids: ["beat-1"],
          summary: "Summary",
          waves: [],
          assumptions: [],
          unassigned_beat_ids: [],
        },
        "plan-with-repo",
      ).data,
      makePlanKnot(
        {
          beat_ids: ["beat-2"],
          summary: "Legacy summary",
          waves: [],
          assumptions: [],
          unassigned_beat_ids: [],
        },
        "plan-without-repo",
      ).data,
      {
        id: "plain-work-knot",
        type: "work",
        state: "queued",
        updated_at: "2026-04-14T01:00:00Z",
      },
    ],
  });

  const plans = await listPlans("/repo");

  expect(mockListKnots).toHaveBeenCalledWith("/repo");
  expect(plans).toHaveLength(2);
  expect(plans.map((plan) => plan.artifact.id)).toEqual([
    "plan-with-repo",
    "plan-without-repo",
  ]);
  expect(plans[0]?.plan.repoPath).toBe("/repo");
  expect(plans[1]?.plan.repoPath).toBe("");
});
