import { describe, expect, it } from "vitest";
import {
  getBeadColumns,
} from "@/components/bead-columns";

describe("getBeadColumns", () => {
  it("returns an array of column definitions", () => {
    const cols = getBeadColumns();
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.length).toBeGreaterThan(0);
  });

  it("returns columns with boolean false (legacy compat)", () => {
    const cols = getBeadColumns(false);
    expect(Array.isArray(cols)).toBe(true);
  });

  it("returns columns with boolean true for showRepoColumn", () => {
    const cols = getBeadColumns(true);
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(true);
  });

  it("adds repo column when showRepoColumn is true in opts", () => {
    const cols = getBeadColumns({ showRepoColumn: true });
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(true);
  });

  it("does not add repo column when showRepoColumn is false", () => {
    const cols = getBeadColumns({ showRepoColumn: false });
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(false);
  });

  it("adds action column when onShipBeat is provided", () => {
    const cols = getBeadColumns({ onShipBeat: () => {} });
    const hasAction = cols.some((c) => c.id === "action");
    expect(hasAction).toBe(true);
  });

  it("does not add action column when onShipBeat is not provided", () => {
    const cols = getBeadColumns({});
    const hasAction = cols.some((c) => c.id === "action");
    expect(hasAction).toBe(false);
  });

  it("always adds ownerType column", () => {
    const cols = getBeadColumns({});
    const hasOwnerType = cols.some((c) => c.id === "ownerType");
    expect(hasOwnerType).toBe(true);
  });
});
