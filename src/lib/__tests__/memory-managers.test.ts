import { describe, expect, it } from "vitest";
import {
  getMemoryManagerLabel,
  getKnownMemoryManagerMarkers,
  isKnownMemoryManagerType,
  listKnownMemoryManagers,
} from "@/lib/memory-managers";

describe("memory-managers", () => {
  it("declares knots as a known memory manager", () => {
    const memoryManagers = listKnownMemoryManagers();
    expect(memoryManagers.some((memoryManager) => memoryManager.type === "knots")).toBe(true);
  });

  it("declares beads as a known memory manager", () => {
    const memoryManagers = listKnownMemoryManagers();
    expect(memoryManagers.some((memoryManager) => memoryManager.type === "beads")).toBe(true);
  });

  it("returns a label for known memory manager types", () => {
    expect(getMemoryManagerLabel("knots")).toBe("Knots");
    expect(getMemoryManagerLabel("beads")).toBe("Beads");
  });

  it("returns Unknown for unsupported memory manager types", () => {
    expect(getMemoryManagerLabel("foo")).toBe("Unknown");
    expect(getMemoryManagerLabel(undefined)).toBe("Unknown");
  });

  it("exposes known marker directory names", () => {
    expect(getKnownMemoryManagerMarkers()).toContain(".knots");
    expect(getKnownMemoryManagerMarkers()).toContain(".beads");
  });

  it("validates known memory manager type values", () => {
    expect(isKnownMemoryManagerType("knots")).toBe(true);
    expect(isKnownMemoryManagerType("beads")).toBe(true);
    expect(isKnownMemoryManagerType("foo")).toBe(false);
  });
});
