/**
 * Coverage tests for src/lib/backend-factory.ts
 * Focuses on AutoRoutingBackend delegated methods and createConcreteBackend paths.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockBeadsBuildTakePrompt,
  mockBeadsBuildPollPrompt,
  mockBeadsBackendCtor,
  mockBeadsCapabilities,
  MockBeadsBackend,
} = vi.hoisted(() => {
  const mockBeadsBuildTakePrompt = vi.fn();
  const mockBeadsBuildPollPrompt = vi.fn();
  const mockBeadsBackendCtor = vi.fn();
  const mockBeadsCapabilities = {
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canClose: true,
    canSearch: true,
    canQuery: true,
    canListReady: true,
    canManageDependencies: true,
    canManageLabels: true,
    canSync: false,
    maxConcurrency: 1,
  };
  class MockBeadsBackend {
    capabilities = mockBeadsCapabilities;

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
    mockBeadsCapabilities,
    MockBeadsBackend,
  };
});

vi.mock("@/lib/memory-manager-detection", () => ({
  detectMemoryManagerType: vi.fn(() => "beads"),
}));

// Mock bd.ts so BdCliBackend doesn't try to run real CLI commands
vi.mock("@/lib/bd", () => ({
  listBeats: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  readyBeats: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  searchBeats: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  queryBeats: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  showBeat: vi.fn(() => Promise.resolve({ ok: true, data: { id: "x" } })),
  createBeat: vi.fn(() => Promise.resolve({ ok: true, data: { id: "new" } })),
  updateBeat: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
  deleteBeat: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
  closeBeat: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
  listDeps: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  addDep: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
  removeDep: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
}));

vi.mock("@/lib/backends/beads-backend", () => ({
  BeadsBackend: MockBeadsBackend,
  BEADS_CAPABILITIES: mockBeadsCapabilities,
}));

import { AutoRoutingBackend, createBackend } from "@/lib/backend-factory";
import { detectMemoryManagerType } from "@/lib/memory-manager-detection";

const REPO = "/repo";

describe("AutoRoutingBackend", () => {
  let arb: AutoRoutingBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectMemoryManagerType).mockReturnValue("beads");
    mockBeadsBuildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated take", claimed: false },
    });
    mockBeadsBuildPollPrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated poll", claimedId: "beat-1" },
    });
    arb = new AutoRoutingBackend();
  });

  describe("repo type resolution", () => {
    it("returns FULL_CAPABILITIES when no repoPath given (advisory only)", () => {
      const caps = arb.capabilitiesForRepo();
      expect(caps.canCreate).toBe(true);
    });

    it("resolves to knots when memory manager is knots", () => {
      vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
      const caps = arb.capabilitiesForRepo(REPO);
      expect(caps).toBeDefined();
    });

    it("resolves to cli for beads memory manager", () => {
      vi.mocked(detectMemoryManagerType).mockReturnValue("beads");
      const caps = arb.capabilitiesForRepo(REPO);
      expect(caps.canCreate).toBe(true);
    });

    it("returns FULL_CAPABILITIES for unknown memory manager (advisory only)", () => {
      vi.mocked(detectMemoryManagerType).mockReturnValue(undefined);
      const caps = arb.capabilitiesForRepo(REPO);
      expect(caps).toBeDefined();
      expect(caps.canCreate).toBe(true);
    });

    it("caches repo type resolution", () => {
      vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
      arb.capabilitiesForRepo(REPO);
      arb.capabilitiesForRepo(REPO);
      // Only called once due to cache
      expect(detectMemoryManagerType).toHaveBeenCalledTimes(1);
    });

    it("clearRepoCache clears specific repo", () => {
      vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
      arb.capabilitiesForRepo(REPO);
      arb.clearRepoCache(REPO);
      arb.capabilitiesForRepo(REPO);
      expect(detectMemoryManagerType).toHaveBeenCalledTimes(2);
    });

    it("clearRepoCache clears all when no arg", () => {
      vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
      arb.capabilitiesForRepo("/a");
      arb.capabilitiesForRepo("/b");
      arb.clearRepoCache();
      arb.capabilitiesForRepo("/a");
      expect(detectMemoryManagerType).toHaveBeenCalledTimes(3);
    });
  });

});

describe("AutoRoutingBackend delegated methods", () => {
  let arb: AutoRoutingBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-pin the detection mock — earlier describe blocks mutate the
    // implementation via mockReturnValue, and `clearAllMocks` does not
    // reset implementations.
    vi.mocked(detectMemoryManagerType).mockReturnValue("beads");
    mockBeadsBuildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated take", claimed: false },
    });
    mockBeadsBuildPollPrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "delegated poll", claimedId: "beat-1" },
    });
    arb = new AutoRoutingBackend();
  });

  describe("delegated methods", () => {
    it("listWorkflows with no repoPath returns builtin descriptors without delegating", async () => {
      const r = await arb.listWorkflows();
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.data)).toBe(true);
      expect((r.data ?? []).length).toBeGreaterThan(0);
      expect(mockBeadsBackendCtor).not.toHaveBeenCalled();
    });

    it("list delegates", async () => {
      const r = await arb.list({}, REPO);
      expect(r.ok).toBe(true);
    });

    it("listReady delegates", async () => {
      const r = await arb.listReady({}, REPO);
      expect(r.ok).toBe(true);
    });

    it("search delegates", async () => {
      const r = await arb.search("q", {}, REPO);
      expect(r.ok).toBe(true);
    });

    it("query delegates", async () => {
      const r = await arb.query("state:open", {}, REPO);
      expect(r.ok).toBe(true);
    });

    it("get delegates", async () => {
      const r = await arb.get("x", REPO);
      expect(r.ok).toBe(true);
    });

    it("create delegates", async () => {
      const r = await arb.create({ title: "t" } as never, REPO);
      expect(r.ok).toBe(true);
    });

    it("update delegates", async () => {
      const r = await arb.update("id", {} as never, REPO);
      expect(r.ok).toBe(true);
    });

    it("delete delegates", async () => {
      const r = await arb.delete("id", REPO);
      expect(r.ok).toBe(true);
    });

    it("close delegates", async () => {
      const r = await arb.close("id", undefined, REPO);
      expect(r.ok).toBe(true);
    });

    it("listDependencies delegates", async () => {
      const r = await arb.listDependencies("id", REPO);
      expect(r.ok).toBe(true);
    });

    it("addDependency delegates", async () => {
      const r = await arb.addDependency("a", "b", REPO);
      expect(r.ok).toBe(true);
    });

    it("removeDependency delegates", async () => {
      const r = await arb.removeDependency("a", "b", REPO);
      expect(r.ok).toBe(true);
    });

    it("buildTakePrompt delegates", async () => {
      const r = await arb.buildTakePrompt("id", undefined, REPO);
      expect(r.ok).toBe(true);
      expect(mockBeadsBackendCtor).toHaveBeenCalledTimes(1);
    });

    it("buildPollPrompt delegates", async () => {
      const r = await arb.buildPollPrompt(undefined, REPO);
      expect(r.ok).toBe(true);
      expect(mockBeadsBackendCtor).toHaveBeenCalledTimes(1);
    });
  });
});

describe("createBackend", () => {
  it("creates auto backend by default", () => {
    const entry = createBackend();
    expect(entry.port).toBeInstanceOf(AutoRoutingBackend);
  });

  it("creates cli backend", () => {
    const entry = createBackend("cli");
    expect(entry.capabilities.canCreate).toBe(true);
  });

  it("creates stub backend", () => {
    const entry = createBackend("stub");
    expect(entry.capabilities.canCreate).toBe(false);
  });

  it("creates beads backend", () => {
    const entry = createBackend("beads");
    expect(entry.capabilities).toBeDefined();
  });

  it("creates knots backend", () => {
    const entry = createBackend("knots");
    expect(entry.capabilities).toBeDefined();
  });
});
