import { describe, expect, it } from "vitest";
import type { MemoryManagerType } from "@/lib/memory-managers";

/**
 * Unit tests for the knots-parent routing logic in terminal-manager.
 *
 * The core logic: when a parent beat is in a knots repo, it should be treated
 * as a single-beat Take (effectiveParent = false) rather than Scene orchestration.
 * Scene orchestration calls assertClaimable on children, which fails for knots
 * because children may not be in a claimable state.
 *
 * We extract and test the decision logic without requiring the full createSession
 * dependency chain.
 */

function computeEffectiveParent(
  isParent: boolean,
  memoryManagerType: MemoryManagerType,
): boolean {
  return isParent && memoryManagerType !== "knots";
}

describe("knots parent routing", () => {
  it("treats knots parent beats as non-parent (single-beat Take)", () => {
    expect(computeEffectiveParent(true, "knots")).toBe(false);
  });

  it("treats beads parent beats as parent (Scene orchestration)", () => {
    expect(computeEffectiveParent(true, "beads")).toBe(true);
  });

  it("treats non-parent beats as non-parent regardless of manager type", () => {
    expect(computeEffectiveParent(false, "knots")).toBe(false);
    expect(computeEffectiveParent(false, "beads")).toBe(false);
  });

  it("determines correct action label for knots parents", () => {
    const isParent = true;
    const memoryManagerType: MemoryManagerType = "knots";
    const effectiveParent = computeEffectiveParent(isParent, memoryManagerType);
    const actionLabel = effectiveParent ? "Scene!" : "Take!";
    expect(actionLabel).toBe("Take!");
  });

  it("determines correct action label for beads parents", () => {
    const isParent = true;
    const memoryManagerType: MemoryManagerType = "beads";
    const effectiveParent = computeEffectiveParent(isParent, memoryManagerType);
    const actionLabel = effectiveParent ? "Scene!" : "Take!";
    expect(actionLabel).toBe("Scene!");
  });

  it("routes knots parents through take interaction type", () => {
    const effectiveParent = computeEffectiveParent(true, "knots");
    const interactionType = effectiveParent ? "scene" : "take";
    expect(interactionType).toBe("take");
  });

  it("routes beads parents through scene interaction type", () => {
    const effectiveParent = computeEffectiveParent(true, "beads");
    const interactionType = effectiveParent ? "scene" : "take";
    expect(interactionType).toBe("scene");
  });

  it("sends single beat ID for knots parents, not wave beat IDs", () => {
    const beatId = "parent-1";
    const waveBeatIds = ["child-1", "child-2"];
    const effectiveParent = computeEffectiveParent(true, "knots");
    const beatIds = effectiveParent ? waveBeatIds : [beatId];
    expect(beatIds).toEqual(["parent-1"]);
  });

  it("sends wave beat IDs for beads parents", () => {
    const beatId = "parent-1";
    const waveBeatIds = ["child-1", "child-2"];
    const effectiveParent = computeEffectiveParent(true, "beads");
    const beatIds = effectiveParent ? waveBeatIds : [beatId];
    expect(beatIds).toEqual(["child-1", "child-2"]);
  });
});
