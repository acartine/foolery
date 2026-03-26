import { describe, expect, it } from "vitest";
import {
  getDisplayedBeatAliases,
  getDisplayedBeatId,
  getShipBeatPayload,
  isTerminalBeat,
} from "@/components/beat-detail-lightbox";
import type { Beat } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-aa57",
    title: "Detail lightbox beat",
    type: "work",
    state: "implementation",
    priority: 2,
    labels: [],
    created: "2026-03-23T09:00:00.000Z",
    updated: "2026-03-23T09:00:00.000Z",
    ...overrides,
  };
}

describe("beat detail lightbox identity helpers", () => {
  it("keeps the full beat ID for the detail header", () => {
    expect(getDisplayedBeatId("foolery-aa57", null)).toBe("foolery-aa57");
    expect(getDisplayedBeatId("foolery-aa57", { id: "other-bb11" })).toBe("other-bb11");
  });

  it("deduplicates aliases against the beat id", () => {
    expect(
      getDisplayedBeatAliases({
        id: "foolery-aa57",
        aliases: ["  aa57  ", "project-aa57", "aa57", "foolery-aa57", "", "   "],
      }),
    ).toEqual(["aa57", "project-aa57"]);
  });

  it("retains full project-qualified aliases from other projects", () => {
    expect(
      getDisplayedBeatAliases({
        id: "proj-1234",
        aliases: ["proj-5678.3"],
      }),
    ).toEqual(["proj-5678.3"]);
  });

  it("returns an empty list when no aliases are present", () => {
    expect(getDisplayedBeatAliases(null)).toEqual([]);
    expect(getDisplayedBeatAliases({ id: "x", aliases: undefined })).toEqual([]);
  });

  it("adds repo scope to the Take! payload when the lightbox knows the repo", () => {
    const beat = makeBeat();
    const payload = getShipBeatPayload(beat, "  /tmp/foolery  ") as Beat & { _repoPath?: string };

    expect(payload).toMatchObject({
      id: beat.id,
      _repoPath: "/tmp/foolery",
    });
    expect(payload).not.toBe(beat);
  });

  it("leaves the original beat unchanged when no repo scope is available", () => {
    const beat = makeBeat();

    expect(getShipBeatPayload(beat)).toBe(beat);
    expect(getShipBeatPayload(beat, "   ")).toBe(beat);
  });
});

describe("isTerminalBeat", () => {
  it.each(["shipped", "abandoned", "closed"] as const)(
    "returns true for terminal state: %s",
    (state) => {
      expect(isTerminalBeat({ state })).toBe(true);
    },
  );

  it.each([
    "implementation",
    "planning",
    "ready_for_planning",
    "open",
  ] as const)(
    "returns false for non-terminal state: %s",
    (state) => {
      expect(isTerminalBeat({ state })).toBe(false);
    },
  );
});
