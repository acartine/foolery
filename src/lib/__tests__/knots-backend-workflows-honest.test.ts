import { describe, expect, it } from "vitest";
import { toDescriptor } from "@/lib/backends/knots-backend-workflows";
import type { KnotProfileDefinition } from "@/lib/knots";

/**
 * kno workflows are the single source of truth. toDescriptor MUST NOT
 * synthesize transitions (historical bug: `withWildcardTerminals`
 * injected `* -> <terminal>` rows, which collided with the generic
 * update path's force-flag heuristic). This test locks that in.
 */

function baseAutopilotProfile(): KnotProfileDefinition {
  return {
    id: "autopilot",
    owners: {
      planning: { kind: "agent" },
      plan_review: { kind: "agent" },
      implementation: { kind: "agent" },
      implementation_review: { kind: "agent" },
      shipment: { kind: "agent" },
      shipment_review: { kind: "agent" },
    },
    initial_state: "ready_for_planning",
    states: [
      "ready_for_planning",
      "planning",
      "ready_for_plan_review",
      "plan_review",
      "ready_for_implementation",
      "implementation",
      "ready_for_implementation_review",
      "implementation_review",
      "ready_for_shipment",
      "shipment",
      "ready_for_shipment_review",
      "shipment_review",
      "shipped",
      "deferred",
      "abandoned",
    ],
    terminal_states: ["shipped", "abandoned"],
    transitions: [
      { from: "ready_for_planning", to: "planning" },
      { from: "planning", to: "ready_for_plan_review" },
      { from: "shipment_review", to: "shipped" },
      { from: "*", to: "deferred" },
      { from: "*", to: "abandoned" },
    ],
  };
}

describe("toDescriptor: kno-authoritative transitions", () => {
  it("returns transitions byte-equal to the supplied profile", () => {
    const profile = baseAutopilotProfile();
    const descriptor = toDescriptor(profile);
    expect(descriptor.transitions).toEqual(profile.transitions);
  });

  it("does not inject a wildcard * -> shipped row", () => {
    const descriptor = toDescriptor(baseAutopilotProfile());
    const wildcardShipped = (descriptor.transitions ?? []).filter(
      (t) => t.from === "*" && t.to === "shipped",
    );
    expect(wildcardShipped).toHaveLength(0);
  });

  it("preserves real (profile-supplied) wildcards verbatim", () => {
    const descriptor = toDescriptor(baseAutopilotProfile());
    expect(descriptor.transitions).toContainEqual({
      from: "*", to: "deferred",
    });
    expect(descriptor.transitions).toContainEqual({
      from: "*", to: "abandoned",
    });
  });

  it("emits no transitions when the profile has none", () => {
    const profile: KnotProfileDefinition = {
      id: "empty",
      owners: {},
      initial_state: "a",
      states: ["a", "b"],
      terminal_states: ["b"],
      transitions: [],
    };
    const descriptor = toDescriptor(profile);
    expect(descriptor.transitions).toEqual([]);
  });
});
