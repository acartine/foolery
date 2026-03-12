import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendPort } from "@/lib/backend-port";
import type { Beat, MemoryWorkflowDescriptor } from "@/lib/types";

// ── Mocks ──────────────────────────────────────────────────

const mockResolveMemoryManagerType = vi.fn();
vi.mock("@/lib/memory-manager-commands", () => ({
  resolveMemoryManagerType: (...args: unknown[]) => mockResolveMemoryManagerType(...args),
}));

const mockClaimKnot = vi.fn();
const mockUpdateKnot = vi.fn();
const mockPollKnot = vi.fn();
const mockNextKnot = vi.fn();
vi.mock("@/lib/knots", () => ({
  claimKnot: (...args: unknown[]) => mockClaimKnot(...args),
  updateKnot: (...args: unknown[]) => mockUpdateKnot(...args),
  pollKnot: (...args: unknown[]) => mockPollKnot(...args),
  nextKnot: (...args: unknown[]) => mockNextKnot(...args),
}));

vi.mock("@/lib/beads-state-machine", () => ({
  nextBeat: vi.fn(),
}));

vi.mock("@/lib/agent-prompt-guardrails", () => ({
  wrapExecutionPrompt: (prompt: string) => `wrapped:${prompt}`,
}));

vi.mock("@/lib/beats-skill-prompts", () => ({
  getBeatsSkillPrompt: vi.fn(() => "skill-prompt"),
}));

vi.mock("@/lib/workflows", () => ({
  builtinProfileDescriptor: () => stubWorkflow,
  defaultWorkflowDescriptor: () => stubWorkflow,
  forwardTransitionTarget: vi.fn(),
  resolveStep: vi.fn(() => null),
  StepPhase: { Queued: "queued" },
}));

const mockGetBackend = vi.fn();
vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => mockGetBackend(),
}));

import { StructuredExecutionBackend } from "@/lib/execution-backend";

// ── Stubs ──────────────────────────────────────────────────

const stubBeat: Beat = {
  id: "beat-1",
  title: "Test beat",
  type: "task",
  state: "ready",
  priority: 3,
  labels: [],
  created: "2026-01-01",
  updated: "2026-01-01",
};

const stubWorkflow: MemoryWorkflowDescriptor = {
  id: "wf-1",
  backingWorkflowId: "wf-1",
  label: "Test",
  mode: "granular_autonomous",
  initialState: "backlog",
  states: ["backlog", "ready", "done"],
  terminalStates: ["done"],
  finalCutState: null,
  retakeState: "ready",
  promptProfileId: "default",
};

function createMockBackend(): BackendPort {
  return {
    get: vi.fn(async () => ({ ok: true, data: stubBeat })),
    list: vi.fn(async () => ({ ok: true, data: [] })),
    listWorkflows: vi.fn(async () => ({ ok: true, data: [stubWorkflow] })),
    listDependencies: vi.fn(async () => ({ ok: true, data: [] })),
    listReady: vi.fn(async () => ({ ok: true, data: [] })),
    create: vi.fn(async () => ({ ok: true, data: stubBeat })),
    update: vi.fn(async () => ({ ok: true, data: stubBeat })),
    remove: vi.fn(async () => ({ ok: true, data: undefined })),
    addDependency: vi.fn(async () => ({ ok: true, data: undefined })),
    removeDependency: vi.fn(async () => ({ ok: true, data: undefined })),
    close: vi.fn(async () => ({ ok: true, data: undefined })),
  } as unknown as BackendPort;
}

// ── Helpers ────────────────────────────────────────────────

/** Seed a lease with rollback.kind="note" via the knots prepareTake path. */
async function seedNoteLease(backend: StructuredExecutionBackend): Promise<string> {
  mockResolveMemoryManagerType.mockReturnValue("knots");
  mockClaimKnot.mockResolvedValue({
    ok: true,
    data: { id: "beat-1", title: "Test", state: "in_progress", profile_id: "default", prompt: "do work" },
  });
  const result = await backend.prepareTake({ beatId: "beat-1", repoPath: "/repo", mode: "take" });
  if (!result.ok || !result.data) throw new Error("Failed to seed note lease");
  return result.data.leaseId;
}

/** Seed a lease with rollback.kind="noop" via the scene prepareTake path. */
async function seedNoopLease(backend: StructuredExecutionBackend): Promise<string> {
  mockResolveMemoryManagerType.mockReturnValue("beads");
  const result = await backend.prepareTake({
    beatId: "beat-1",
    repoPath: "/repo",
    mode: "scene",
    childBeatIds: ["child-1"],
  });
  if (!result.ok || !result.data) throw new Error("Failed to seed noop lease");
  return result.data.leaseId;
}

// ── Tests ──────────────────────────────────────────────────

describe("rollbackIteration", () => {
  let seb: StructuredExecutionBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockBackend = createMockBackend();
    mockGetBackend.mockReturnValue(mockBackend);
    seb = new StructuredExecutionBackend(mockBackend);
  });

  it("records rollback note and deletes lease for kind=note on knots repo", async () => {
    const leaseId = await seedNoteLease(seb);
    mockResolveMemoryManagerType.mockReturnValue("knots");
    mockUpdateKnot.mockResolvedValue({ ok: true });

    const result = await seb.rollbackIteration({ leaseId, reason: "agent crashed" });

    expect(result.ok).toBe(true);
    expect(mockUpdateKnot).toHaveBeenCalledOnce();
    const [beatId, updateInput] = mockUpdateKnot.mock.calls[0];
    expect(beatId).toBe("beat-1");
    expect(updateInput.addNote).toContain("Take iteration failed before completion.");
    expect(updateInput.addNote).toContain("Reason: agent crashed");

    // Lease should be deleted: a second rollback with same id should return NOT_FOUND
    const again = await seb.rollbackIteration({ leaseId, reason: "retry" });
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("NOT_FOUND");
  });

  it("skips note and deletes lease for kind=noop", async () => {
    const leaseId = await seedNoopLease(seb);

    const result = await seb.rollbackIteration({ leaseId, reason: "cancelled" });

    expect(result.ok).toBe(true);
    expect(mockUpdateKnot).not.toHaveBeenCalled();

    // Lease deleted
    const again = await seb.rollbackIteration({ leaseId, reason: "retry" });
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for unknown lease", async () => {
    const result = await seb.rollbackIteration({ leaseId: "nonexistent", reason: "gone" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.message).toContain("Unknown execution lease");
  });

  it("returns fail and retains lease when updateKnot fails", async () => {
    const leaseId = await seedNoteLease(seb);
    mockResolveMemoryManagerType.mockReturnValue("knots");
    mockUpdateKnot.mockResolvedValue({ ok: false, error: "db write failed" });

    const result = await seb.rollbackIteration({ leaseId, reason: "something broke" });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("db write failed");

    // Lease should still exist because the early return happens before delete.
    // A subsequent rollback with a passing updateKnot should succeed.
    mockUpdateKnot.mockResolvedValue({ ok: true });
    const retry = await seb.rollbackIteration({ leaseId, reason: "retry" });
    expect(retry.ok).toBe(true);
  });

  it("skips note block when kind=note but note is falsy", async () => {
    // Seed a lease via the knots path (creates kind="note" with a truthy note),
    // then mutate the returned lease object to have an empty note. Because the
    // same object reference is stored in the internal leaseStore, this mutation
    // is reflected when rollbackIteration reads the lease.
    mockResolveMemoryManagerType.mockReturnValue("knots");
    mockClaimKnot.mockResolvedValue({
      ok: true,
      data: { id: "beat-1", title: "Test", state: "in_progress", profile_id: "default", prompt: "do work" },
    });
    const prepResult = await seb.prepareTake({ beatId: "beat-1", repoPath: "/repo", mode: "take" });
    expect(prepResult.ok).toBe(true);
    const lease = prepResult.data!;
    // Mutate the shared reference to make note falsy
    lease.rollback.note = "";
    mockResolveMemoryManagerType.mockReturnValue("knots");

    const result = await seb.rollbackIteration({ leaseId: lease.leaseId, reason: "empty note" });

    expect(result.ok).toBe(true);
    expect(mockUpdateKnot).not.toHaveBeenCalled();

    // Lease deleted
    const again = await seb.rollbackIteration({ leaseId: lease.leaseId, reason: "retry" });
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("NOT_FOUND");
  });

  it("skips note block when kind=note on non-knots repo", async () => {
    const leaseId = await seedNoteLease(seb);
    // Switch memory manager to beads for the rollback call
    mockResolveMemoryManagerType.mockReturnValue("beads");

    const result = await seb.rollbackIteration({ leaseId, reason: "wrong repo type" });

    expect(result.ok).toBe(true);
    expect(mockUpdateKnot).not.toHaveBeenCalled();

    // Lease deleted
    const again = await seb.rollbackIteration({ leaseId, reason: "retry" });
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("NOT_FOUND");
  });
});
