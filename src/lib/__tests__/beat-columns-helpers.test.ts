import { describe, expect, it } from "vitest";
import {
  getBeatColumns,
} from "@/components/beat-columns";

describe("getBeatColumns", () => {
  it("returns an array of column definitions", () => {
    const cols = getBeatColumns();
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.length).toBeGreaterThan(0);
  });

  it("returns columns with boolean false (legacy compat)", () => {
    const cols = getBeatColumns(false);
    expect(Array.isArray(cols)).toBe(true);
  });

  it("returns columns with boolean true for showRepoColumn", () => {
    const cols = getBeatColumns(true);
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(true);
  });

  it("adds repo column when showRepoColumn is true in opts", () => {
    const cols = getBeatColumns({ showRepoColumn: true });
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(true);
  });

  it("does not add repo column when showRepoColumn is false", () => {
    const cols = getBeatColumns({ showRepoColumn: false });
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(false);
  });

  it("adds action column when onShipBeat is provided", () => {
    const cols = getBeatColumns({ onShipBeat: () => {} });
    const hasAction = cols.some((c) => c.id === "action");
    expect(hasAction).toBe(true);
  });

  it("does not add action column when onShipBeat is not provided", () => {
    const cols = getBeatColumns({});
    const hasAction = cols.some((c) => c.id === "action");
    expect(hasAction).toBe(false);
  });

  it("always adds ownerType column", () => {
    const cols = getBeatColumns({});
    const hasOwnerType = cols.some((c) => c.id === "ownerType");
    expect(hasOwnerType).toBe(true);
  });
});
