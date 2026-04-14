import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationPlan } from "@/lib/types";

const mockAddEdge = vi.fn();
const mockBackendGet = vi.fn();
const mockCreateSession = vi.fn();
const mockGetSession = vi.fn();
const mockListEdges = vi.fn();
const mockListKnots = vi.fn();
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

vi.mock("@/lib/orchestration-manager", () => ({
  createOrchestrationSession: (...args: unknown[]) =>
    mockCreateSession(...args),
  getOrchestrationSession: (...args: unknown[]) =>
    mockGetSession(...args),
}));

vi.mock("@/lib/terminal-manager", () => ({
  createSession: (...args: unknown[]) =>
    mockCreateSession(...args),
}));

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ get: mockBackendGet }),
}));

import {
  completePlanStep,
  createPlan,
  failPlanStep,
  getPlan,
  getNextPlanStep,
  listPlans,
  startPlanStep,
} from "@/lib/orchestration-plan-manager";

function makeSessionEntry() {
  const emitter = new EventEmitter();
  return {
    emitter,
    session: {
      id: "orch-1",
      repoPath: "/repo",
      status: "running",
      startedAt: "2026-04-14T00:00:00Z",
      plan: undefined as OrchestrationPlan | undefined,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListEdges.mockResolvedValue({ ok: true, data: [] });
  mockAddEdge.mockResolvedValue({ ok: true });
  mockRemoveEdge.mockResolvedValue({ ok: true });
});

describe("orchestration-plan-manager createPlan", () => {
  it("creates a plan, persists execution_plan payload, and links beats", async () => {
    const entry = makeSessionEntry();
    mockCreateSession.mockResolvedValue({ id: "orch-1" });
    mockGetSession.mockImplementation(() => entry);
    mockNewKnot.mockResolvedValue({ ok: true, data: { id: "plan-1" } });
    mockListEdges.mockResolvedValue({ ok: true, data: [] });
    mockAddEdge.mockResolvedValue({ ok: true });
    mockRemoveEdge.mockResolvedValue({ ok: true });
    mockUpdateKnot.mockImplementation(
      async (
        _id: string,
        input: { executionPlanFile?: string },
      ) => {
        const filePath = input.executionPlanFile;
        expect(filePath).toBeTruthy();
        const raw = await readFile(filePath!, "utf8");
        const parsed = JSON.parse(raw);
        expect(parsed.repo_path).toBe("/repo");
        expect(parsed.unassigned_beat_ids).toEqual(["beat-3"]);
        return { ok: true };
      },
    );

    const promise = createPlan({
      repoPath: "/repo",
      objective: "Ship it",
      mode: "groom",
    });
    entry.session.plan = {
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
        },
      ],
      unassignedBeatIds: ["beat-3"],
      assumptions: ["One"],
    };
    entry.session.status = "completed";
    entry.emitter.emit("data", {
      type: "exit",
      data: "done",
    });

    await expect(promise).resolves.toEqual({
      planId: "plan-1",
    });
    expect(mockCreateSession).toHaveBeenCalledWith(
      "/repo",
      "Ship it",
      {
        model: undefined,
        mode: "groom",
      },
    );
    expect(mockNewKnot).toHaveBeenCalledWith(
      "Execution plan: Ship it",
      expect.objectContaining({ type: "execution_plan" }),
      "/repo",
    );
    expect(mockAddEdge).toHaveBeenCalledTimes(2);
  });
});

describe("orchestration-plan-manager queries", () => {
  it("maps plan knots back into API plans with implicit steps", async () => {
    mockShowKnot.mockResolvedValue({
      ok: true,
      data: {
        id: "plan-1",
        type: "execution_plan",
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T01:00:00Z",
        execution_plan: {
          repo_path: "/repo",
          status: "draft",
          summary: "Summary",
          waves: [
            {
              waveIndex: 1,
              name: "Wave 1",
              objective: "Do work",
              agents: [],
              beats: [{ id: "beat-1", title: "Beat 1" }],
            },
          ],
          assumptions: [],
          unassigned_beat_ids: [],
        },
      },
    });

    const plan = await getPlan("plan-1");
    expect(plan?.waves[0]?.steps[0]).toMatchObject({
      waveIndex: 1,
      stepIndex: 1,
      beatIds: ["beat-1"],
      status: "pending",
    });
  });

  it("lists only plan knots for the requested repo", async () => {
    mockListKnots.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "plan-1",
          type: "execution_plan",
          created_at: "2026-04-14T00:00:00Z",
          updated_at: "2026-04-14T01:00:00Z",
          execution_plan: {
            repo_path: "/repo",
            status: "draft",
            summary: "Summary",
            waves: [],
            assumptions: [],
            unassigned_beat_ids: [],
          },
        },
        {
          id: "plan-2",
          type: "execution_plan",
          created_at: "2026-04-14T00:00:00Z",
          updated_at: "2026-04-14T01:00:00Z",
          execution_plan: {
            repo_path: "/other",
            status: "draft",
            summary: "Other",
            waves: [],
            assumptions: [],
            unassigned_beat_ids: [],
          },
        },
      ],
    });

    const plans = await listPlans("/repo");
    expect(plans).toHaveLength(1);
    expect(plans[0]?.id).toBe("plan-1");
  });
});

describe("orchestration-plan-manager next step", () => {
  it("returns the next executable step in order", async () => {
    mockShowKnot.mockResolvedValue({
      ok: true,
      data: {
        id: "plan-1",
        type: "execution_plan",
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T01:00:00Z",
        execution_plan: {
          repo_path: "/repo",
          status: "active",
          waves: [
            {
              waveIndex: 1,
              name: "Wave 1",
              objective: "Do work",
              beats: [{ id: "beat-1", title: "Beat 1" }],
              steps: [
                {
                  id: "step-1",
                  title: "First",
                  beat_ids: ["beat-1"],
                  status: "complete",
                },
                {
                  id: "step-2",
                  title: "Second",
                  beat_ids: ["beat-2"],
                  status: "pending",
                  depends_on: ["step-1"],
                },
              ],
            },
          ],
          assumptions: [],
          unassigned_beat_ids: [],
        },
      },
    });

    await expect(
      getNextPlanStep("plan-1", "/repo"),
    ).resolves.toMatchObject({
      id: "step-2",
      status: "pending",
    });
  });
});

describe("orchestration-plan-manager startPlanStep", () => {
  it("starts a pending step, creates sessions, and persists state", async () => {
    mockShowKnot.mockResolvedValue({
      ok: true,
      data: {
        id: "plan-1",
        type: "execution_plan",
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T01:00:00Z",
        execution_plan: {
          repo_path: "/repo",
          status: "draft",
          waves: [
            {
              waveIndex: 1,
              name: "Wave 1",
              objective: "Do work",
              beats: [
                { id: "beat-1", title: "Beat 1" },
                { id: "beat-2", title: "Beat 2" },
              ],
              steps: [
                {
                  id: "step-1",
                  title: "First",
                  beat_ids: ["beat-1", "beat-2"],
                  status: "pending",
                },
              ],
            },
          ],
          assumptions: [],
          unassigned_beat_ids: [],
        },
      },
    });
    mockCreateSession
      .mockResolvedValueOnce({ id: "term-1" })
      .mockResolvedValueOnce({ id: "term-2" });
    mockUpdateKnot.mockImplementation(
      async (
        _id: string,
        input: { executionPlanFile?: string },
      ) => {
        const raw = await readFile(
          input.executionPlanFile!,
          "utf8",
        );
        const parsed = JSON.parse(raw);
        expect(parsed.status).toBe("active");
        expect(
          parsed.waves[0]?.steps[0]?.status,
        ).toBe("in_progress");
        expect(
          parsed.waves[0]?.steps[0]?.started_at,
        ).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
        return { ok: true };
      },
    );

    await expect(
      startPlanStep("plan-1", "step-1", "/repo"),
    ).resolves.toEqual({
      beats: [
        { beatId: "beat-1", sessionId: "term-1" },
        { beatId: "beat-2", sessionId: "term-2" },
      ],
    });
    expect(mockCreateSession).toHaveBeenNthCalledWith(
      1,
      "beat-1",
      "/repo",
    );
    expect(mockCreateSession).toHaveBeenNthCalledWith(
      2,
      "beat-2",
      "/repo",
    );
  });
});

describe("orchestration-plan-manager completePlanStep", () => {
  it("completes an in-progress step only after all beats are shipped", async () => {
    mockShowKnot.mockResolvedValue({
      ok: true,
      data: {
        id: "plan-1",
        type: "execution_plan",
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T01:00:00Z",
        execution_plan: {
          repo_path: "/repo",
          status: "active",
          waves: [
            {
              waveIndex: 1,
              name: "Wave 1",
              objective: "Do work",
              beats: [{ id: "beat-1", title: "Beat 1" }],
              steps: [
                {
                  id: "step-1",
                  title: "First",
                  beat_ids: ["beat-1"],
                  status: "in_progress",
                },
              ],
            },
          ],
          assumptions: [],
          unassigned_beat_ids: [],
        },
      },
    });
    mockBackendGet.mockResolvedValue({
      ok: true,
      data: { id: "beat-1", state: "shipped" },
    });
    mockUpdateKnot.mockImplementation(
      async (
        _id: string,
        input: { executionPlanFile?: string },
      ) => {
        const raw = await readFile(
          input.executionPlanFile!,
          "utf8",
        );
        const parsed = JSON.parse(raw);
        expect(parsed.status).toBe("complete");
        expect(
          parsed.waves[0]?.steps[0]?.status,
        ).toBe("complete");
        return { ok: true };
      },
    );

    await expect(
      completePlanStep("plan-1", "step-1", "/repo"),
    ).resolves.toEqual({
      stepId: "step-1",
      status: "complete",
    });
  });
});

describe("orchestration-plan-manager failPlanStep", () => {
  it("fails a step, records the reason, and aborts the plan", async () => {
    mockShowKnot.mockResolvedValue({
      ok: true,
      data: {
        id: "plan-1",
        type: "execution_plan",
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T01:00:00Z",
        execution_plan: {
          repo_path: "/repo",
          status: "active",
          waves: [
            {
              waveIndex: 1,
              name: "Wave 1",
              objective: "Do work",
              beats: [{ id: "beat-1", title: "Beat 1" }],
              steps: [
                {
                  id: "step-1",
                  title: "First",
                  beat_ids: ["beat-1"],
                  status: "in_progress",
                },
              ],
            },
          ],
          assumptions: [],
          unassigned_beat_ids: [],
        },
      },
    });
    mockUpdateKnot.mockImplementation(
      async (
        _id: string,
        input: { executionPlanFile?: string },
      ) => {
        const raw = await readFile(
          input.executionPlanFile!,
          "utf8",
        );
        const parsed = JSON.parse(raw);
        expect(parsed.status).toBe("aborted");
        expect(
          parsed.waves[0]?.steps[0]?.status,
        ).toBe("failed");
        expect(
          parsed.waves[0]?.steps[0]?.failure_reason,
        ).toBe("Session crashed");
        return { ok: true };
      },
    );

    await expect(
      failPlanStep(
        "plan-1",
        "step-1",
        "Session crashed",
        "/repo",
      ),
    ).resolves.toEqual({
      stepId: "step-1",
      status: "failed",
    });
  });
});
