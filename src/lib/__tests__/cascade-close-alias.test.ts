import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Beat } from "@/lib/types";
import type { BackendPort } from "@/lib/backend-port";

const mockList = vi.fn();
const mockClose = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () =>
    ({
      list: mockList,
      close: mockClose,
    }) as unknown as BackendPort,
}));

import { getOpenDescendants } from "@/lib/cascade-close";

function makeBeat(overrides: Partial<Beat>): Beat {
  return {
    id: "test",
    title: "Test",
    state: "open",
    priority: 2,
    type: "task",
    labels: [],
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("getOpenDescendants alias passthrough", () => {
  it("includes alias in CascadeDescendant when present", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        makeBeat({ id: "parent", state: "open" }),
        makeBeat({ id: "child-1", parent: "parent", state: "open", alias: "auth-refactor", title: "Auth Refactor" }),
      ],
    });

    const result = await getOpenDescendants("parent");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.alias).toBe("auth-refactor");
  });

  it("omits alias when beat has no alias", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        makeBeat({ id: "parent", state: "open" }),
        makeBeat({ id: "child-1", parent: "parent", state: "open", title: "No Alias" }),
      ],
    });

    const result = await getOpenDescendants("parent");
    expect(result.ok).toBe(true);
    expect(result.data?.[0]?.alias).toBeUndefined();
  });
});
