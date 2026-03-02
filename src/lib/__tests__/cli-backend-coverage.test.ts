/**
 * Coverage tests for src/lib/backends/bd-cli-backend.ts
 * Tests the BdCliBackend adapter which wraps bd.ts functions.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/bd", () => ({
  listBeats: vi.fn(),
  readyBeats: vi.fn(),
  searchBeats: vi.fn(),
  queryBeats: vi.fn(),
  showBeat: vi.fn(),
  createBeat: vi.fn(),
  updateBeat: vi.fn(),
  deleteBeat: vi.fn(),
  closeBeat: vi.fn(),
  listDeps: vi.fn(),
  addDep: vi.fn(),
  removeDep: vi.fn(),
}));

import { BdCliBackend } from "@/lib/backends/bd-cli-backend";
import * as bd from "@/lib/bd";

const bdMock = bd as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("BdCliBackend", () => {
  let backend: BdCliBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new BdCliBackend();
  });

  it("has FULL_CAPABILITIES", () => {
    expect(backend.capabilities.canCreate).toBe(true);
    expect(backend.capabilities.canUpdate).toBe(true);
  });

  it("listWorkflows returns builtin descriptors", async () => {
    const r = await backend.listWorkflows();
    expect(r.ok).toBe(true);
  });

  // --- toBR converter: success path ---
  it("list delegates to bd.listBeats and converts success", async () => {
    bdMock.listBeats.mockResolvedValue({ ok: true, data: [{ id: "1" }] });
    const r = await backend.list();
    expect(r).toEqual({ ok: true, data: [{ id: "1" }] });
  });

  // --- toBR converter: error path ---
  it("list converts error string to structured error", async () => {
    bdMock.listBeats.mockResolvedValue({ ok: false, error: "something went wrong" });
    const r = await backend.list();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error!.code).toBe("INTERNAL");
      expect(r.error!.message).toBe("something went wrong");
    }
  });

  it("list converts unknown error to INTERNAL", async () => {
    bdMock.listBeats.mockResolvedValue({ ok: false });
    const r = await backend.list();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error!.code).toBe("INTERNAL");
      expect(r.error!.message).toBe("Unknown error");
    }
  });

  // --- filtersToRecord helper ---
  it("list passes undefined filters as undefined", async () => {
    bdMock.listBeats.mockResolvedValue({ ok: true, data: [] });
    await backend.list(undefined, "/repo");
    expect(bdMock.listBeats).toHaveBeenCalledWith(undefined, "/repo");
  });

  it("list converts filters to record", async () => {
    bdMock.listBeats.mockResolvedValue({ ok: true, data: [] });
    await backend.list({ state: "open", priority: 2 } as never);
    expect(bdMock.listBeats).toHaveBeenCalledWith(
      { state: "open", priority: "2" },
      undefined,
    );
  });

  it("list strips null/undefined filter values", async () => {
    bdMock.listBeats.mockResolvedValue({ ok: true, data: [] });
    await backend.list({ state: undefined, label: null } as never);
    expect(bdMock.listBeats).toHaveBeenCalledWith(undefined, undefined);
  });

  // --- All delegated methods ---
  it("listReady delegates to bd.readyBeats", async () => {
    bdMock.readyBeats.mockResolvedValue({ ok: true, data: [] });
    const r = await backend.listReady(undefined, "/repo");
    expect(r.ok).toBe(true);
  });

  it("search delegates to bd.searchBeats", async () => {
    bdMock.searchBeats.mockResolvedValue({ ok: true, data: [] });
    const r = await backend.search("query", undefined, "/repo");
    expect(r.ok).toBe(true);
    expect(bdMock.searchBeats).toHaveBeenCalledWith("query", undefined, "/repo");
  });

  it("query delegates to bd.queryBeats", async () => {
    bdMock.queryBeats.mockResolvedValue({ ok: true, data: [] });
    const r = await backend.query("state:open", undefined, "/repo");
    expect(r.ok).toBe(true);
  });

  it("get delegates to bd.showBeat", async () => {
    bdMock.showBeat.mockResolvedValue({ ok: true, data: { id: "x" } });
    const r = await backend.get("x", "/repo");
    expect(r.ok).toBe(true);
  });

  it("create delegates to bd.createBeat", async () => {
    bdMock.createBeat.mockResolvedValue({ ok: true, data: { id: "new" } });
    const r = await backend.create({ title: "test" } as never, "/repo");
    expect(r.ok).toBe(true);
  });

  it("update delegates to bd.updateBeat", async () => {
    bdMock.updateBeat.mockResolvedValue({ ok: true, data: undefined });
    const r = await backend.update("id", { title: "updated" } as never, "/repo");
    expect(r.ok).toBe(true);
  });

  it("delete delegates to bd.deleteBeat", async () => {
    bdMock.deleteBeat.mockResolvedValue({ ok: true, data: undefined });
    const r = await backend.delete("id", "/repo");
    expect(r.ok).toBe(true);
  });

  it("close delegates to bd.closeBeat", async () => {
    bdMock.closeBeat.mockResolvedValue({ ok: true, data: undefined });
    const r = await backend.close("id", "done", "/repo");
    expect(r.ok).toBe(true);
  });

  it("listDependencies delegates to bd.listDeps", async () => {
    bdMock.listDeps.mockResolvedValue({ ok: true, data: [] });
    const r = await backend.listDependencies("id", "/repo", { type: "blocks" });
    expect(r.ok).toBe(true);
  });

  it("addDependency delegates to bd.addDep", async () => {
    bdMock.addDep.mockResolvedValue({ ok: true, data: undefined });
    const r = await backend.addDependency("a", "b", "/repo");
    expect(r.ok).toBe(true);
  });

  it("removeDependency delegates to bd.removeDep", async () => {
    bdMock.removeDep.mockResolvedValue({ ok: true, data: undefined });
    const r = await backend.removeDependency("a", "b", "/repo");
    expect(r.ok).toBe(true);
  });

  // --- buildTakePrompt ---
  it("buildTakePrompt returns prompt for a regular beat", async () => {
    const r = await backend.buildTakePrompt("beat-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data!.prompt).toContain("beat-1");
      expect(r.data!.claimed).toBe(false);
    }
  });

  it("buildTakePrompt returns parent prompt with child IDs", async () => {
    const r = await backend.buildTakePrompt("parent-1", {
      isParent: true,
      childBeatIds: ["child-1", "child-2"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data!.prompt).toContain("Parent beat ID");
      expect(r.data!.prompt).toContain("child-1");
      expect(r.data!.prompt).toContain("child-2");
    }
  });

  // --- buildPollPrompt ---
  it("buildPollPrompt returns UNAVAILABLE", async () => {
    const r = await backend.buildPollPrompt();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });
});
