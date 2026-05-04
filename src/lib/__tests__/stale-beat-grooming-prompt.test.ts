import { describe, expect, it } from "vitest";
import {
  buildStaleBeatGroomingPrompt,
  parseStaleBeatGroomingOutput,
} from "@/lib/stale-beat-grooming-prompt";

describe("stale beat grooming prompt", () => {
  it("includes beat context and the decision contract", () => {
    const prompt = buildStaleBeatGroomingPrompt({
      ageDays: 12,
      beat: {
        id: "foolery-1234",
        title: "Old idea",
        state: "ready_for_planning",
        description: "Build the thing",
        acceptance: "1. It works",
      },
    });

    expect(prompt).toContain("foolery-1234");
    expect(prompt).toContain("12 days");
    expect(prompt).toContain("still_do");
    expect(prompt).toContain("reshape");
    expect(prompt).toContain("drop");
  });

  it("parses tagged review output", () => {
    expect(
      parseStaleBeatGroomingOutput(`
        <stale_beat_grooming_json>
        {
          "decision": "reshape",
          "rationale": "Product vocabulary changed.",
          "suggestedTitle": "New shape"
        }
        </stale_beat_grooming_json>
      `),
    ).toEqual({
      decision: "reshape",
      rationale: "Product vocabulary changed.",
      suggestedTitle: "New shape",
    });
  });

  it("rejects invalid decisions and unparseable output", () => {
    expect(
      parseStaleBeatGroomingOutput(JSON.stringify({
        decision: "maybe",
        rationale: "Nope",
      })),
    ).toBeNull();
    expect(parseStaleBeatGroomingOutput("not json")).toBeNull();
  });
});
