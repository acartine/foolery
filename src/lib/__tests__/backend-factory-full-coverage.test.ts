/**
 * Coverage tests for src/lib/backend-factory.ts
 * Focuses on AutoRoutingBackend delegated methods and createConcreteBackend paths.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { AutoRoutingBackend, createBackend } from "@/lib/backend-factory";
import { detectMemoryManagerType } from "@/lib/memory-manager-detection";

describe("AutoRoutingBackend", () => {
  let arb: AutoRoutingBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    arb = new AutoRoutingBackend("cli");
  });

  it("resolves to fallback when no repoPath given", () => {
    const caps = arb.capabilitiesForRepo();
    expect(caps.canCreate).toBe(true); // cli has full caps
  });

  it("resolves to knots when memory manager is knots", () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
    const caps = arb.capabilitiesForRepo("/repo");
    expect(caps).toBeDefined();
  });

  it("resolves to cli for beads memory manager", () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue("beads");
    const caps = arb.capabilitiesForRepo("/repo");
    expect(caps.canCreate).toBe(true);
  });

  it("resolves to fallback for unknown memory manager", () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue(null as never);
    const caps = arb.capabilitiesForRepo("/repo");
    expect(caps).toBeDefined();
  });

  it("caches repo type resolution", () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
    arb.capabilitiesForRepo("/repo");
    arb.capabilitiesForRepo("/repo");
    // Only called once due to cache
    expect(detectMemoryManagerType).toHaveBeenCalledTimes(1);
  });

  it("clearRepoCache clears specific repo", () => {
    vi.mocked(detectMemoryManagerType).mockReturnValue("knots");
    arb.capabilitiesForRepo("/repo");
    arb.clearRepoCache("/repo");
    arb.capabilitiesForRepo("/repo");
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

  // --- Delegated methods ---
  it("listWorkflows delegates", async () => {
    const r = await arb.listWorkflows();
    expect(r.ok).toBe(true);
  });

  it("list delegates", async () => {
    const r = await arb.list();
    expect(r.ok).toBe(true);
  });

  it("listReady delegates", async () => {
    const r = await arb.listReady();
    expect(r.ok).toBe(true);
  });

  it("search delegates", async () => {
    const r = await arb.search("q");
    expect(r.ok).toBe(true);
  });

  it("query delegates", async () => {
    const r = await arb.query("state:open");
    expect(r.ok).toBe(true);
  });

  it("get delegates", async () => {
    const r = await arb.get("x");
    expect(r.ok).toBe(true);
  });

  it("create delegates", async () => {
    const r = await arb.create({ title: "t" } as never);
    expect(r.ok).toBe(true);
  });

  it("update delegates", async () => {
    const r = await arb.update("id", {} as never);
    expect(r.ok).toBe(true);
  });

  it("delete delegates", async () => {
    const r = await arb.delete("id");
    expect(r.ok).toBe(true);
  });

  it("close delegates", async () => {
    const r = await arb.close("id");
    expect(r.ok).toBe(true);
  });

  it("listDependencies delegates", async () => {
    const r = await arb.listDependencies("id");
    expect(r.ok).toBe(true);
  });

  it("addDependency delegates", async () => {
    const r = await arb.addDependency("a", "b");
    expect(r.ok).toBe(true);
  });

  it("removeDependency delegates", async () => {
    const r = await arb.removeDependency("a", "b");
    expect(r.ok).toBe(true);
  });

  it("buildTakePrompt delegates", async () => {
    const r = await arb.buildTakePrompt("id");
    expect(r.ok).toBe(true);
  });

  it("buildPollPrompt delegates", async () => {
    const r = await arb.buildPollPrompt();
    // cli backend returns UNAVAILABLE for poll
    expect(r.ok).toBe(false);
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
