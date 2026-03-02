/**
 * Contract tests for StubBackend.
 *
 * Uses the shared contract test harness to verify the stub satisfies
 * the BackendPort behavioural contract for its capability set.
 *
 * Also exercises every stub method directly to ensure coverage of
 * read-only stubs and UNAVAILABLE write stubs (lines 42, 74-90, 111-173).
 */

import { describe, it, expect } from "vitest";
import { runBackendContractTests } from "./backend-contract.test";
import { StubBackend, STUB_CAPABILITIES } from "@/lib/backends/stub-backend";

// ── Contract harness ────────────────────────────────────────

runBackendContractTests("StubBackend", () => {
  const port = new StubBackend();
  return {
    port,
    capabilities: STUB_CAPABILITIES,
    cleanup: async () => {},
  };
});

// ── Direct method coverage ──────────────────────────────────

describe("StubBackend direct method tests", () => {
  const backend = new StubBackend();

  // -- Read stubs that return empty arrays --

  it("listReady() returns ok:true with empty array", async () => {
    const result = await backend.listReady();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("listReady() accepts optional filters and repoPath", async () => {
    const result = await backend.listReady({ state: "ready" }, "/tmp");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("search() returns ok:true with empty array", async () => {
    const result = await backend.search("anything");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("search() accepts optional filters and repoPath", async () => {
    const result = await backend.search("q", { type: "task" }, "/tmp");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("query() returns ok:true with empty array", async () => {
    const result = await backend.query("type:task");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("query() accepts optional options and repoPath", async () => {
    const result = await backend.query("priority:1", {}, "/tmp");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("listDependencies() returns ok:true with empty array", async () => {
    const result = await backend.listDependencies("any-id");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("listDependencies() accepts optional repoPath and options", async () => {
    const result = await backend.listDependencies("id", "/tmp", {
      type: "blocks",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  // -- Write stubs that return UNAVAILABLE --

  it("create() returns UNAVAILABLE error", async () => {
    const result = await backend.create({
      title: "t",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("create");
    expect(result.error?.retryable).toBe(false);
  });

  it("update() returns UNAVAILABLE error", async () => {
    const result = await backend.update("id", { title: "new" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("update");
    expect(result.error?.retryable).toBe(false);
  });

  it("delete() returns UNAVAILABLE error", async () => {
    const result = await backend.delete("id");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("delete");
    expect(result.error?.retryable).toBe(false);
  });

  it("close() returns UNAVAILABLE error", async () => {
    const result = await backend.close("id", "done");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("close");
    expect(result.error?.retryable).toBe(false);
  });

  it("addDependency() returns UNAVAILABLE error", async () => {
    const result = await backend.addDependency("a", "b");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("addDependency");
    expect(result.error?.retryable).toBe(false);
  });

  it("removeDependency() returns UNAVAILABLE error", async () => {
    const result = await backend.removeDependency("a", "b");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("removeDependency");
    expect(result.error?.retryable).toBe(false);
  });

  it("buildTakePrompt() returns UNAVAILABLE error", async () => {
    const result = await backend.buildTakePrompt("beat-1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("buildTakePrompt");
    expect(result.error?.retryable).toBe(false);
  });

  it("buildTakePrompt() accepts optional options and repoPath", async () => {
    const result = await backend.buildTakePrompt("beat-1", {}, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
  });

  it("buildPollPrompt() returns UNAVAILABLE error", async () => {
    const result = await backend.buildPollPrompt();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(result.error?.message).toContain("buildPollPrompt");
    expect(result.error?.retryable).toBe(false);
  });

  it("buildPollPrompt() accepts optional options and repoPath", async () => {
    const result = await backend.buildPollPrompt({}, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
  });

  // -- Capabilities object --

  it("STUB_CAPABILITIES is frozen and read-only", () => {
    expect(Object.isFrozen(STUB_CAPABILITIES)).toBe(true);
    expect(STUB_CAPABILITIES.canCreate).toBe(false);
    expect(STUB_CAPABILITIES.canUpdate).toBe(false);
    expect(STUB_CAPABILITIES.canDelete).toBe(false);
    expect(STUB_CAPABILITIES.canClose).toBe(false);
    expect(STUB_CAPABILITIES.canSearch).toBe(true);
    expect(STUB_CAPABILITIES.canQuery).toBe(true);
    expect(STUB_CAPABILITIES.canListReady).toBe(true);
    expect(STUB_CAPABILITIES.canManageDependencies).toBe(false);
    expect(STUB_CAPABILITIES.canManageLabels).toBe(false);
    expect(STUB_CAPABILITIES.canSync).toBe(false);
    expect(STUB_CAPABILITIES.maxConcurrency).toBe(0);
  });

  it("backend.capabilities matches STUB_CAPABILITIES", () => {
    expect(backend.capabilities).toBe(STUB_CAPABILITIES);
  });
});
