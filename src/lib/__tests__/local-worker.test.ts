import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListReady = vi.fn();
const mockGet = vi.fn();
const mockListWorkflows = vi.fn();
const mockListDeps = vi.fn();
const mockList = vi.fn();
const mockUpdate = vi.fn();
const mockResolveMemoryManagerType = vi.fn(() => "beads");
const mockClaimKnot = vi.fn();
const mockPollKnot = vi.fn();
const mockNextKnot = vi.fn();
const mockUpdateKnot = vi.fn();
const mockCreateLease = vi.fn();
const mockTerminateLease = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    listReady: (...args: unknown[]) => mockListReady(...args),
    get: (...args: unknown[]) => mockGet(...args),
    listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
    listDependencies: (...args: unknown[]) => mockListDeps(...args),
    list: (...args: unknown[]) => mockList(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  }),
}));

vi.mock("@/lib/memory-manager-commands", () => ({
  resolveMemoryManagerType: () => mockResolveMemoryManagerType(),
  buildWorkflowStateCommand: vi.fn((beatId: string, state: string) => `bd update ${beatId} ${state}`),
}));

vi.mock("@/lib/knots", () => ({
  claimKnot: (...args: unknown[]) => mockClaimKnot(...args),
  pollKnot: (...args: unknown[]) => mockPollKnot(...args),
  nextKnot: (...args: unknown[]) => mockNextKnot(...args),
  updateKnot: (...args: unknown[]) => mockUpdateKnot(...args),
  createLease: (...args: unknown[]) => mockCreateLease(...args),
  terminateLease: (...args: unknown[]) => mockTerminateLease(...args),
}));

vi.mock("@/lib/lease-audit", () => ({
  logLeaseAudit: vi.fn(),
}));

import { LocalWorkerService } from "@/lib/local-worker";

describe("LocalWorkerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMemoryManagerType.mockReturnValue("beads");
    mockCreateLease.mockResolvedValue({ ok: true, data: { id: "lease-k1" } });
    mockTerminateLease.mockResolvedValue({ ok: true });
  });

  it("blocks memory-manager binaries from shell_exec", async () => {
    const worker = new LocalWorkerService();
    const result = await worker.runTool(
      { name: "shell_exec", input: { command: "kno claim foo --json" } },
      "foolery-test",
      "/tmp/repo",
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain("shell_exec blocks kno");
  });

  it("prepares a poll lease for claimable beads work", async () => {
    mockListReady.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "foolery-1",
          title: "Test",
          state: "ready_for_implementation",
          isAgentClaimable: true,
          type: "task",
          priority: 2,
          labels: [],
          created: "2026-03-05T00:00:00Z",
          updated: "2026-03-05T00:00:00Z",
        },
      ],
    });
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-1",
        title: "Test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
        type: "task",
        priority: 2,
        labels: [],
        created: "2026-03-05T00:00:00Z",
        updated: "2026-03-05T00:00:00Z",
      },
    });
    mockListWorkflows.mockResolvedValue({ ok: true, data: [] });
    mockListDeps.mockResolvedValue({ ok: true, data: [] });
    mockList.mockResolvedValue({ ok: true, data: [] });
    mockUpdate.mockResolvedValue({ ok: true });

    const worker = new LocalWorkerService();
    const result = await worker.preparePoll("/tmp/repo");

    expect(result.ok).toBe(true);
    expect(result.data?.claimedId).toBe("foolery-1");
    expect(result.data?.lease.prompt).toContain("foolery-1");
  });

  it("wraps scene prompts for parent work", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-parent",
        title: "Parent",
        state: "ready_for_implementation",
        isAgentClaimable: true,
        type: "task",
        priority: 2,
        labels: [],
        created: "2026-03-05T00:00:00Z",
        updated: "2026-03-05T00:00:00Z",
      },
    });
    mockListWorkflows.mockResolvedValue({ ok: true, data: [] });
    mockListDeps.mockResolvedValue({ ok: true, data: [] });
    mockList.mockResolvedValue({ ok: true, data: [] });

    const worker = new LocalWorkerService();
    const result = await worker.prepareTake({
      beatId: "foolery-parent",
      repoPath: "/tmp/repo",
      isParent: true,
      childBeatIds: ["foolery-child-1", "foolery-child-2"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain("Execute child beats in parallel when practical");
    expect(result.data?.prompt).toContain("foolery-child-1");
    expect(result.data?.prompt).toContain("foolery-child-2");
  });

  it("returns populated knotsLeaseId for knots-backed poll work", async () => {
    mockResolveMemoryManagerType.mockReturnValue("knots");
    mockPollKnot.mockResolvedValue({
      ok: true,
      data: {
        id: "knot-1",
        title: "Knots Test",
        state: "implementation",
        profile_id: "autopilot",
        prompt: "knots prompt",
      },
    });
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        id: "knot-1",
        title: "Knots Test",
        state: "implementation",
        isAgentClaimable: false,
        type: "task",
        priority: 2,
        labels: [],
        created: "2026-03-05T00:00:00Z",
        updated: "2026-03-05T00:00:00Z",
      },
    });
    mockListWorkflows.mockResolvedValue({ ok: true, data: [] });
    mockListDeps.mockResolvedValue({ ok: true, data: [] });
    mockList.mockResolvedValue({ ok: true, data: [] });

    const worker = new LocalWorkerService();
    const result = await worker.preparePoll("/tmp/repo", {
      agentName: "Codex",
      agentModel: "codex/gpt",
      agentVersion: "5.4",
      agentProvider: "OpenAI",
      agentType: "cli",
    });

    expect(result.ok).toBe(true);
    expect(mockCreateLease).toHaveBeenCalledOnce();
    expect(result.data?.lease.knotsLeaseId).toBe("lease-k1");
  });
});
