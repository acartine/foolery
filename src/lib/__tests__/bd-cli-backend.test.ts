/**
 * Tests for BdCliBackend -- the adapter that delegates to bd CLI functions
 * and converts BdResult<T> into BackendResult<T>.
 *
 * Mocks the @/lib/bd module so no real CLI invocations occur.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BdResult, Beat, BeatDependency } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mock bd module
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockListBeats = vi.fn<(...args: any[]) => Promise<BdResult<Beat[]>>>();
const mockReadyBeats = vi.fn<(...args: any[]) => Promise<BdResult<Beat[]>>>();
const mockSearchBeats = vi.fn<(...args: any[]) => Promise<BdResult<Beat[]>>>();
const mockQueryBeats = vi.fn<(...args: any[]) => Promise<BdResult<Beat[]>>>();
const mockShowBeat = vi.fn<(...args: any[]) => Promise<BdResult<Beat>>>();
const mockCreateBeat = vi.fn<(...args: any[]) => Promise<BdResult<{ id: string }>>>();
const mockUpdateBeat = vi.fn<(...args: any[]) => Promise<BdResult<void>>>();
const mockDeleteBeat = vi.fn<(...args: any[]) => Promise<BdResult<void>>>();
const mockCloseBeat = vi.fn<(...args: any[]) => Promise<BdResult<void>>>();
const mockListDeps = vi.fn<(...args: any[]) => Promise<BdResult<BeatDependency[]>>>();
const mockAddDep = vi.fn<(...args: any[]) => Promise<BdResult<void>>>();
const mockRemoveDep = vi.fn<(...args: any[]) => Promise<BdResult<void>>>();
const {
  mockBeadsBuildTakePrompt,
  mockBeadsBuildPollPrompt,
  mockBeadsBackendCtor,
  MockBeadsBackend,
} = vi.hoisted(() => {
  const mockBeadsBuildTakePrompt = vi.fn<
    (...args: any[]) => Promise<unknown>
  >();
  const mockBeadsBuildPollPrompt = vi.fn<
    (...args: any[]) => Promise<unknown>
  >();
  const mockBeadsBackendCtor = vi.fn();
  class MockBeadsBackend {
    constructor(...args: unknown[]) {
      mockBeadsBackendCtor(...args);
    }

    buildTakePrompt(...args: unknown[]): Promise<unknown> {
      return mockBeadsBuildTakePrompt(...(args as []));
    }

    buildPollPrompt(...args: unknown[]): Promise<unknown> {
      return mockBeadsBuildPollPrompt(...(args as []));
    }
  }
  return {
    mockBeadsBuildTakePrompt,
    mockBeadsBuildPollPrompt,
    mockBeadsBackendCtor,
    MockBeadsBackend,
  };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock("@/lib/bd", () => ({
  listBeats: (...args: unknown[]) => mockListBeats(...(args as [])),
  readyBeats: (...args: unknown[]) => mockReadyBeats(...(args as [])),
  searchBeats: (...args: unknown[]) => mockSearchBeats(...(args as [])),
  queryBeats: (...args: unknown[]) => mockQueryBeats(...(args as [])),
  showBeat: (...args: unknown[]) => mockShowBeat(...(args as [])),
  createBeat: (...args: unknown[]) => mockCreateBeat(...(args as [])),
  updateBeat: (...args: unknown[]) => mockUpdateBeat(...(args as [])),
  deleteBeat: (...args: unknown[]) => mockDeleteBeat(...(args as [])),
  closeBeat: (...args: unknown[]) => mockCloseBeat(...(args as [])),
  listDeps: (...args: unknown[]) => mockListDeps(...(args as [])),
  addDep: (...args: unknown[]) => mockAddDep(...(args as [])),
  removeDep: (...args: unknown[]) => mockRemoveDep(...(args as [])),
}));

vi.mock("@/lib/backends/beads-backend", () => ({
  BeadsBackend: MockBeadsBackend,
}));

// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

import { BdCliBackend } from "@/lib/backends/bd-cli-backend";
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_BEAT: Beat = {
  id: "test-1",
  title: "Sample beat",
  type: "task",
  state: "open",
  workflowId: "autopilot",
  workflowMode: "granular_autonomous",
  profileId: "autopilot",
  priority: 2,
  labels: [],
  created: "2026-01-01T00:00:00Z",
  updated: "2026-01-02T00:00:00Z",
} as Beat;

const SAMPLE_DEP: BeatDependency = {
  id: "dep-1",
  beat_id: "test-1",
  depends_on_id: "test-2",
  type: "blocks",
} as BeatDependency;

function resetAllMocks(): void {
  mockListBeats.mockReset();
  mockReadyBeats.mockReset();
  mockSearchBeats.mockReset();
  mockQueryBeats.mockReset();
  mockShowBeat.mockReset();
  mockCreateBeat.mockReset();
  mockUpdateBeat.mockReset();
  mockDeleteBeat.mockReset();
  mockCloseBeat.mockReset();
  mockListDeps.mockReset();
  mockAddDep.mockReset();
  mockRemoveDep.mockReset();
  mockBeadsBuildTakePrompt.mockReset();
  mockBeadsBuildPollPrompt.mockReset();
  mockBeadsBackendCtor.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function setupBdCliBackend(): BdCliBackend {
  resetAllMocks();
  mockBeadsBuildTakePrompt.mockResolvedValue({
    ok: true,
    data: { prompt: "delegated take", claimed: false },
  });
  mockBeadsBuildPollPrompt.mockResolvedValue({
    ok: true,
    data: { prompt: "delegated poll", claimedId: "beat-1" },
  });
  return new BdCliBackend();
}

describe("BdCliBackend capabilities and workflows", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    backend = setupBdCliBackend();
  });

  it("exposes FULL_CAPABILITIES", () => {
    expect(backend.capabilities).toBe(FULL_CAPABILITIES);
  });

  it("returns builtin workflow descriptors", async () => {
    const result = await backend.listWorkflows();
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data ?? []).length).toBeGreaterThan(0);
  });

  it("accepts optional repoPath without error", async () => {
    const result = await backend.listWorkflows();
    expect(result.ok).toBe(true);
  });
});

describe("BdCliBackend toBR (result conversion)", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    backend = setupBdCliBackend();
  });

  it("converts ok BdResult to ok BackendResult", async () => {
    mockListBeats.mockResolvedValue({ ok: true, data: [SAMPLE_BEAT] });
    const result = await backend.list();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([SAMPLE_BEAT]);
    expect(result.error).toBeUndefined();
  });

  it("converts 'not found' to NOT_FOUND", async () => {
    mockShowBeat.mockResolvedValue({
      ok: false,
      error: "Resource not found: test-1",
    });
    const result = await backend.get("test-1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.retryable).toBe(false);
  });

  it("converts 'locked' to LOCKED", async () => {
    mockDeleteBeat.mockResolvedValue({
      ok: false,
      error: "database is locked",
    });
    const result = await backend.delete("test-1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LOCKED");
    expect(result.error?.retryable).toBe(true);
  });

  it("converts 'timed out' to TIMEOUT", async () => {
    mockUpdateBeat.mockResolvedValue({
      ok: false,
      error: "Operation timed out",
    });
    const result = await backend.update("test-1", { title: "x" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TIMEOUT");
    expect(result.error?.retryable).toBe(true);
  });

  it("converts 'permission denied' to PERMISSION_DENIED", async () => {
    mockCreateBeat.mockResolvedValue({
      ok: false,
      error: "permission denied",
    });
    const result = await backend.create({
      title: "x", type: "task", priority: 2, labels: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PERMISSION_DENIED");
    expect(result.error?.retryable).toBe(false);
  });

  it("classifies unrecognized error as INTERNAL", async () => {
    mockCloseBeat.mockResolvedValue({
      ok: false,
      error: "something unexpected happened",
    });
    const result = await backend.close("test-1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INTERNAL");
    expect(result.error?.retryable).toBe(false);
  });

  it("uses 'Unknown error' when error string is undefined", async () => {
    mockListBeats.mockResolvedValue({ ok: false });
    const result = await backend.list();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("Unknown error");
    expect(result.error?.code).toBe("INTERNAL");
  });

  it("converts 'already exists' to ALREADY_EXISTS", async () => {
    mockCreateBeat.mockResolvedValue({
      ok: false,
      error: "Resource already exists: dup-1",
    });
    const result = await backend.create({
      title: "dup", type: "task", priority: 2, labels: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ALREADY_EXISTS");
    expect(result.error?.retryable).toBe(false);
  });

  it("converts 'unavailable' to UNAVAILABLE", async () => {
    mockListBeats.mockResolvedValue({
      ok: false,
      error: "backend unavailable",
    });
    const result = await backend.list();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.retryable).toBe(true);
  });
});

describe("BdCliBackend filtersToRecord", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    resetAllMocks();
    mockBeadsBuildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated take", claimed: false },
    });
    mockBeadsBuildPollPrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated poll", claimedId: "beat-1" },
    });
    backend = new BdCliBackend();
  });

  describe("filtersToRecord (via list/listReady/search)", () => {
    it("passes undefined when no filters given", async () => {
      mockListBeats.mockResolvedValue({ ok: true, data: [] });
      await backend.list();
      expect(mockListBeats).toHaveBeenCalledWith(undefined, undefined);
    });

    it("converts typed filters to Record<string, string>", async () => {
      mockListBeats.mockResolvedValue({ ok: true, data: [] });
      await backend.list({ type: "bug", priority: 1 });
      const call = mockListBeats.mock.calls[0];
      expect(call[0]).toEqual({ type: "bug", priority: "1" });
    });

    it("omits null and undefined values from filters", async () => {
      mockReadyBeats.mockResolvedValue({ ok: true, data: [] });
      await backend.listReady({ type: "task", state: undefined });
      const call = mockReadyBeats.mock.calls[0];
      expect(call[0]).toEqual({ type: "task" });
    });

    it("returns undefined when all filter values are undefined/null", async () => {
      mockListBeats.mockResolvedValue({ ok: true, data: [] });
      await backend.list({ type: undefined, state: undefined });
      const call = mockListBeats.mock.calls[0];
      expect(call[0]).toBeUndefined();
    });
  });
});

describe("BdCliBackend list and listReady delegation", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    resetAllMocks();
    backend = new BdCliBackend();
  });

  it("delegates to bd.listBeats with converted filters", async () => {
    mockListBeats.mockResolvedValue({ ok: true, data: [SAMPLE_BEAT] });
    const result = await backend.list({ type: "task" }, "/repo");
    expect(mockListBeats).toHaveBeenCalledWith({ type: "task" }, "/repo");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([SAMPLE_BEAT]);
  });

  it("delegates to bd.readyBeats", async () => {
    mockReadyBeats.mockResolvedValue({ ok: true, data: [] });
    const result = await backend.listReady({ label: "urgent" }, "/repo");
    expect(mockReadyBeats).toHaveBeenCalledWith(
      { label: "urgent" }, "/repo",
    );
    expect(result.ok).toBe(true);
  });
});

describe("BdCliBackend search and query delegation", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    resetAllMocks();
    backend = new BdCliBackend();
  });

  it("delegates to bd.searchBeats with query and filters", async () => {
    mockSearchBeats.mockResolvedValue({ ok: true, data: [SAMPLE_BEAT] });
    const result = await backend.search(
      "login bug", { type: "bug" }, "/repo",
    );
    expect(mockSearchBeats).toHaveBeenCalledWith(
      "login bug", { type: "bug" }, "/repo",
    );
    expect(result.ok).toBe(true);
  });

  it("handles search error", async () => {
    mockSearchBeats.mockResolvedValue({
      ok: false, error: "bd search failed",
    });
    const result = await backend.search("query");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INTERNAL");
  });

  it("delegates to bd.queryBeats with expression and options", async () => {
    mockQueryBeats.mockResolvedValue({ ok: true, data: [] });
    const opts = { limit: 10, sort: "priority" };
    const result = await backend.query("priority < 3", opts, "/repo");
    expect(mockQueryBeats).toHaveBeenCalledWith(
      "priority < 3", opts, "/repo",
    );
    expect(result.ok).toBe(true);
  });
});

describe("BdCliBackend get, create, update, delete, close", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    resetAllMocks();
    backend = new BdCliBackend();
  });

  it("delegates get to bd.showBeat", async () => {
    mockShowBeat.mockResolvedValue({ ok: true, data: SAMPLE_BEAT });
    const result = await backend.get("test-1", "/repo");
    expect(mockShowBeat).toHaveBeenCalledWith("test-1", "/repo");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(SAMPLE_BEAT);
  });

  it("delegates create to bd.createBeat", async () => {
    mockCreateBeat.mockResolvedValue({
      ok: true, data: { id: "new-1" },
    });
    const input = {
      title: "New beat", type: "task",
      priority: 2 as const, labels: [],
    };
    const result = await backend.create(input, "/repo");
    expect(mockCreateBeat).toHaveBeenCalledWith(input, "/repo");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: "new-1" });
  });

  it("delegates update to bd.updateBeat", async () => {
    mockUpdateBeat.mockResolvedValue({ ok: true });
    const result = await backend.update(
      "test-1", { title: "Updated" }, "/repo",
    );
    expect(mockUpdateBeat).toHaveBeenCalledWith(
      "test-1", { title: "Updated" }, "/repo",
    );
    expect(result.ok).toBe(true);
  });

  it("delegates delete to bd.deleteBeat", async () => {
    mockDeleteBeat.mockResolvedValue({ ok: true });
    const result = await backend.delete("test-1", "/repo");
    expect(mockDeleteBeat).toHaveBeenCalledWith("test-1", "/repo");
    expect(result.ok).toBe(true);
  });

  it("delegates close with reason", async () => {
    mockCloseBeat.mockResolvedValue({ ok: true });
    const result = await backend.close("test-1", "done", "/repo");
    expect(mockCloseBeat).toHaveBeenCalledWith(
      "test-1", "done", "/repo",
    );
    expect(result.ok).toBe(true);
  });

  it("delegates close without reason", async () => {
    mockCloseBeat.mockResolvedValue({ ok: true });
    const result = await backend.close("test-1");
    expect(mockCloseBeat).toHaveBeenCalledWith(
      "test-1", undefined, undefined,
    );
    expect(result.ok).toBe(true);
  });
});

describe("BdCliBackend dependency delegation", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    resetAllMocks();
    backend = new BdCliBackend();
  });

  describe("dependencies", () => {
    it("delegates listDependencies to bd.listDeps", async () => {
      mockListDeps.mockResolvedValue({ ok: true, data: [SAMPLE_DEP] });
      const result = await backend.listDependencies("test-1", "/repo", {
        type: "blocks",
      });
      expect(mockListDeps).toHaveBeenCalledWith("test-1", "/repo", {
        type: "blocks",
      });
      expect(result.ok).toBe(true);
      expect(result.data).toEqual([SAMPLE_DEP]);
    });

    it("delegates addDependency to bd.addDep", async () => {
      mockAddDep.mockResolvedValue({ ok: true });
      const result = await backend.addDependency("a", "b", "/repo");
      expect(mockAddDep).toHaveBeenCalledWith("a", "b", "/repo");
      expect(result.ok).toBe(true);
    });

    it("delegates removeDependency to bd.removeDep", async () => {
      mockRemoveDep.mockResolvedValue({ ok: true });
      const result = await backend.removeDependency("a", "b", "/repo");
      expect(mockRemoveDep).toHaveBeenCalledWith("a", "b", "/repo");
      expect(result.ok).toBe(true);
    });
  });
});

describe("BdCliBackend prompt delegation", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    resetAllMocks();
    mockBeadsBuildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated take", claimed: false },
    });
    mockBeadsBuildPollPrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated poll", claimedId: "beat-1" },
    });
    backend = new BdCliBackend();
  });

  it("does not instantiate BeadsBackend for non-prompt operations", async () => {
    mockListBeats.mockResolvedValue({ ok: true, data: [SAMPLE_BEAT] });

    const result = await backend.list();

    expect(result.ok).toBe(true);
    expect(mockBeadsBackendCtor).not.toHaveBeenCalled();
  });

  describe("buildTakePrompt", () => {
    it("delegates to BeadsBackend with options and repoPath", async () => {
      const delegated = {
        ok: true as const,
        data: { prompt: "delegated take prompt", claimed: true },
      };
      mockBeadsBuildTakePrompt.mockResolvedValue(delegated);
      const opts = {
        isParent: true,
        childBeatIds: ["child-a", "child-b"],
      };

      const result = await backend.buildTakePrompt("parent-1", opts, "/repo");

      expect(mockBeadsBackendCtor).toHaveBeenCalledTimes(1);
      expect(mockBeadsBackendCtor).toHaveBeenCalledWith("/repo");
      expect(mockBeadsBuildTakePrompt).toHaveBeenCalledWith(
        "parent-1",
        opts,
        "/repo",
      );
      expect(result).toEqual(delegated);
    });

    it("reuses one lazy BeadsBackend instance across prompt calls", async () => {
      await backend.buildTakePrompt("beat-1");
      await backend.buildPollPrompt();

      expect(mockBeadsBackendCtor).toHaveBeenCalledTimes(1);
    });
  });

  describe("buildPollPrompt", () => {
    it("delegates and returns BeadsBackend poll prompt result", async () => {
      const delegated = {
        ok: true as const,
        data: { prompt: "delegated poll prompt", claimedId: "beat-42" },
      };
      mockBeadsBuildPollPrompt.mockResolvedValue(delegated);
      const opts = {
        agentName: "test-agent",
      };
      const result = await backend.buildPollPrompt(opts, "/repo");

      expect(mockBeadsBackendCtor).toHaveBeenCalledTimes(1);
      expect(mockBeadsBackendCtor).toHaveBeenCalledWith("/repo");
      expect(mockBeadsBuildPollPrompt).toHaveBeenCalledWith(opts, "/repo");
      expect(result).toEqual(delegated);
    });
  });
});
