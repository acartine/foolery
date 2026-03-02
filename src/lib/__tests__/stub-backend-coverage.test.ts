/**
 * Coverage tests for src/lib/backends/stub-backend.ts
 * Covers all methods that return empty arrays or UNAVAILABLE errors.
 */
import { describe, expect, it } from "vitest";
import { StubBackend, STUB_CAPABILITIES } from "@/lib/backends/stub-backend";

describe("StubBackend", () => {
  const backend = new StubBackend();

  it("exposes read-only capabilities", () => {
    expect(backend.capabilities).toBe(STUB_CAPABILITIES);
    expect(STUB_CAPABILITIES.canCreate).toBe(false);
    expect(STUB_CAPABILITIES.canSearch).toBe(true);
  });

  it("listWorkflows returns builtin descriptors", async () => {
    const r = await backend.listWorkflows();
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.ok ? r.data : [])).toBe(true);
  });

  it("list returns empty array", async () => {
    const r = await backend.list();
    expect(r).toEqual({ ok: true, data: [] });
  });

  it("listReady returns empty array", async () => {
    const r = await backend.listReady();
    expect(r).toEqual({ ok: true, data: [] });
  });

  it("search returns empty array", async () => {
    const r = await backend.search("test");
    expect(r).toEqual({ ok: true, data: [] });
  });

  it("query returns empty array", async () => {
    const r = await backend.query("state:open");
    expect(r).toEqual({ ok: true, data: [] });
  });

  it("get returns NOT_FOUND error", async () => {
    const r = await backend.get("abc");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error!.code).toBe("NOT_FOUND");
      expect(r.error!.message).toContain("abc");
    }
  });

  it("create returns UNAVAILABLE error", async () => {
    const r = await backend.create({ title: "test" } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });

  it("update returns UNAVAILABLE error", async () => {
    const r = await backend.update("id", {} as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });

  it("delete returns UNAVAILABLE error", async () => {
    const r = await backend.delete("id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });

  it("close returns UNAVAILABLE error", async () => {
    const r = await backend.close("id", "reason");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });

  it("listDependencies returns empty array", async () => {
    const r = await backend.listDependencies("id");
    expect(r).toEqual({ ok: true, data: [] });
  });

  it("addDependency returns UNAVAILABLE error", async () => {
    const r = await backend.addDependency("a", "b");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });

  it("removeDependency returns UNAVAILABLE error", async () => {
    const r = await backend.removeDependency("a", "b");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });

  it("buildTakePrompt returns UNAVAILABLE error", async () => {
    const r = await backend.buildTakePrompt("id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });

  it("buildPollPrompt returns UNAVAILABLE error", async () => {
    const r = await backend.buildPollPrompt();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error!.code).toBe("UNAVAILABLE");
  });
});
