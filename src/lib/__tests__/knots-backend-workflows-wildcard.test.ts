import { describe, expect, it } from "vitest";
import { toDescriptor } from "@/lib/backends/knots-backend-workflows";
import type { KnotProfileDefinition } from "@/lib/knots";

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
    ],
  };
}

describe("toDescriptor wildcard terminals", () => {
  it("injects a * -> <terminal> transition for each terminal state missing one", () => {
    const descriptor = toDescriptor(baseAutopilotProfile());
    expect(descriptor.transitions).toContainEqual({ from: "*", to: "shipped" });
    expect(descriptor.transitions).toContainEqual({ from: "*", to: "abandoned" });
  });

  it("preserves kno-supplied transitions alongside injected wildcards", () => {
    const descriptor = toDescriptor(baseAutopilotProfile());
    expect(descriptor.transitions).toContainEqual({
      from: "shipment_review",
      to: "shipped",
    });
    expect(descriptor.transitions).toContainEqual({
      from: "planning",
      to: "ready_for_plan_review",
    });
  });

  it("does not duplicate an existing * -> shipped transition", () => {
    const profile = baseAutopilotProfile();
    profile.transitions = [
      ...(profile.transitions ?? []),
      { from: "*", to: "shipped" },
    ];
    const descriptor = toDescriptor(profile);
    const wildcardShipped = (descriptor.transitions ?? []).filter(
      (t) => t.from === "*" && t.to === "shipped",
    );
    expect(wildcardShipped).toHaveLength(1);
  });

  it("omits wildcards for profiles without terminal states", () => {
    const profile: KnotProfileDefinition = {
      id: "loop",
      owners: {},
      initial_state: "a",
      states: ["a", "b"],
      terminal_states: [],
      transitions: [{ from: "a", to: "b" }],
    };
    const descriptor = toDescriptor(profile);
    const wildcards = (descriptor.transitions ?? []).filter((t) => t.from === "*");
    expect(wildcards).toEqual([]);
  });
});
