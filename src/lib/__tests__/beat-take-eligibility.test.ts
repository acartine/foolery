import { describe, expect, it } from "vitest";
import { canTakeBeat, type TakeEligibleBeat } from "@/lib/beat-take-eligibility";

function makeBeat(overrides: Partial<TakeEligibleBeat> = {}): TakeEligibleBeat {
  return {
    state: "ready_for_implementation",
    type: "work",
    nextActionOwnerKind: "agent",
    isAgentClaimable: true,
    ...overrides,
  };
}

describe("canTakeBeat", () => {
  it("allows queue states like ready_for_implementation", () => {
    expect(canTakeBeat(makeBeat())).toBe(true);
  });

  it("blocks terminal states", () => {
    expect(canTakeBeat(makeBeat({ state: "shipped" }))).toBe(false);
    expect(canTakeBeat(makeBeat({ state: "abandoned" }))).toBe(false);
    expect(canTakeBeat(makeBeat({ state: "closed" }))).toBe(false);
  });

  it("allows agent-owned gate beats when they are claimable", () => {
    expect(canTakeBeat(makeBeat({ type: "gate" }))).toBe(true);
  });

  it("blocks human-owned next actions", () => {
    expect(canTakeBeat(makeBeat({ nextActionOwnerKind: "human" }))).toBe(false);
  });

  it("blocks human-owned gate beats", () => {
    expect(
      canTakeBeat(
        makeBeat({
          type: "gate",
          nextActionOwnerKind: "human",
        }),
      ),
    ).toBe(false);
  });

  it("blocks beats explicitly marked not claimable", () => {
    expect(canTakeBeat(makeBeat({ isAgentClaimable: false }))).toBe(false);
  });
});
