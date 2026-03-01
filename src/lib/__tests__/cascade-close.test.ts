import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Beat } from "@/lib/types";
import type { BackendPort, BackendResult } from "@/lib/backend-port";

// Mock backend-instance before importing cascade-close
const mockList = vi.fn();
const mockClose = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () =>
    ({
      list: mockList,
      close: mockClose,
    }) as unknown as BackendPort,
}));

import { getOpenDescendants, cascadeClose } from "@/lib/cascade-close";

function makeBeat(overrides: Partial<Beat>): Beat {
  return {
    id: "test",
    title: "Test",
    description: "",
    state: "open",
    priority: 2,
    type: "task",
    labels: [],
    created: "2026-02-22T00:00:00Z",
    updated: "2026-02-22T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOpenDescendants", () => {
  it("returns empty list when parent has no children", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [makeBeat({ id: "parent", state: "open" })],
    });

    const result = await getOpenDescendants("parent");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("returns open children in leaf-first order", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        makeBeat({ id: "parent", state: "open" }),
        makeBeat({ id: "child-a", parent: "parent", state: "open", title: "Child A" }),
        makeBeat({ id: "child-b", parent: "parent", state: "in_progress", title: "Child B" }),
      ],
    });

    const result = await getOpenDescendants("parent");
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data![0].id).toBe("child-a");
    expect(result.data![1].id).toBe("child-b");
  });

  it("excludes already-closed children", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        makeBeat({ id: "parent", state: "open" }),
        makeBeat({ id: "child-a", parent: "parent", state: "closed", title: "Closed" }),
        makeBeat({ id: "child-b", parent: "parent", state: "open", title: "Open" }),
      ],
    });

    const result = await getOpenDescendants("parent");
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe("child-b");
  });

  it("collects nested grandchildren leaf-first", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        makeBeat({ id: "gp", state: "open" }),
        makeBeat({ id: "parent", parent: "gp", state: "open", title: "Parent" }),
        makeBeat({ id: "leaf", parent: "parent", state: "open", title: "Leaf" }),
      ],
    });

    const result = await getOpenDescendants("gp");
    expect(result.ok).toBe(true);
    // Leaf should appear before parent (post-order traversal)
    expect(result.data!.map((d) => d.id)).toEqual(["leaf", "parent"]);
  });
});

describe("cascadeClose", () => {
  it("closes leaf children before parent", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        makeBeat({ id: "parent", state: "open" }),
        makeBeat({ id: "child", parent: "parent", state: "open", title: "Child" }),
      ],
    });
    mockClose.mockResolvedValue({ ok: true });

    const result = await cascadeClose("parent", "done");
    expect(result.ok).toBe(true);
    expect(result.data!.closed).toEqual(["child", "parent"]);

    // Verify close order: child first, then parent
    const calls = mockClose.mock.calls;
    expect(calls[0][0]).toBe("child");
    expect(calls[1][0]).toBe("parent");
  });

  it("collects errors without blocking siblings", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        makeBeat({ id: "parent", state: "open" }),
        makeBeat({ id: "fail-child", parent: "parent", state: "open", title: "Fail" }),
        makeBeat({ id: "ok-child", parent: "parent", state: "open", title: "OK" }),
      ],
    });
    mockClose.mockImplementation(async (id: string): Promise<BackendResult<void>> => {
      if (id === "fail-child") return { ok: false, error: { code: "INTERNAL", message: "mock error", retryable: false } };
      return { ok: true };
    });

    const result = await cascadeClose("parent");
    expect(result.ok).toBe(true);
    expect(result.data!.closed).toContain("ok-child");
    expect(result.data!.closed).toContain("parent");
    expect(result.data!.errors).toHaveLength(1);
    expect(result.data!.errors[0]).toContain("fail-child");
  });

  it("closes only the parent when no children exist", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [makeBeat({ id: "solo", state: "open" })],
    });
    mockClose.mockResolvedValue({ ok: true });

    const result = await cascadeClose("solo");
    expect(result.ok).toBe(true);
    expect(result.data!.closed).toEqual(["solo"]);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
