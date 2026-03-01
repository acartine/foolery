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

  it("returns managers sorted by precedence (ascending)", () => {
    const memoryManagers = listKnownMemoryManagers();
    for (let i = 1; i < memoryManagers.length; i++) {
      expect(memoryManagers[i].precedence).toBeGreaterThanOrEqual(
        memoryManagers[i - 1].precedence,
      );
    }
  });

  it("assigns knots a lower precedence number than beads", () => {
    const memoryManagers = listKnownMemoryManagers();
    const knots = memoryManagers.find((m) => m.type === "knots")!;
    const beads = memoryManagers.find((m) => m.type === "beads")!;
    expect(knots.precedence).toBeLessThan(beads.precedence);
  });
});
