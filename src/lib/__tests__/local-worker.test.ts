import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListReady = vi.fn();
const mockGet = vi.fn();
const mockListWorkflows = vi.fn();
const mockListDeps = vi.fn();
const mockList = vi.fn();
const mockUpdate = vi.fn();

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

import { LocalWorkerService } from "@/lib/local-worker";

describe("LocalWorkerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
