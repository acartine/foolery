import { describe, expect, it } from "vitest";
import {
  builtinProfileDescriptor,
  builtinWorkflowDescriptors,
} from "@/lib/workflows";

describe("wildcard * -> shipped transition", () => {
  it("is present in the autopilot profile", () => {
    const autopilot = builtinProfileDescriptor("autopilot");
    expect(autopilot.transitions).toBeDefined();
    expect(autopilot.transitions).toContainEqual({
      from: "*",
      to: "shipped",
    });
  });

  it("is present in every built-in profile that includes 'shipped'", () => {
    for (const workflow of builtinWorkflowDescriptors()) {
      if (!workflow.states.includes("shipped")) continue;
      expect(
        workflow.transitions,
        `${workflow.id} should include * -> shipped`,
      ).toContainEqual({ from: "*", to: "shipped" });
    }
  });

  it("coexists with the shipment_review -> shipped forward transition", () => {
    const autopilot = builtinProfileDescriptor("autopilot");
    expect(autopilot.transitions).toContainEqual({
      from: "shipment_review",
      to: "shipped",
    });
    expect(autopilot.transitions).toContainEqual({
      from: "*",
      to: "shipped",
    });
  });
});
