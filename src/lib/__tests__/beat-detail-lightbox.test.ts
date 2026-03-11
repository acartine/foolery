import { describe, expect, it } from "vitest";
import {
  getDisplayedBeatAliases,
  getDisplayedBeatId,
} from "@/components/beat-detail-lightbox";

describe("beat detail lightbox identity helpers", () => {
  it("prefers the natural beat id for the detail header", () => {
    expect(getDisplayedBeatId("foolery-aa57", null)).toBe("aa57");
    expect(getDisplayedBeatId("foolery-aa57", { id: "other-bb11" })).toBe("bb11");
    expect(
      getDisplayedBeatId("foolery-aa57", {
        id: "foolery-aa57",
        aliases: ["proj-1234", "proj-5678.3"],
      }),
    ).toBe("proj-1234");
  });

  it("normalizes beat aliases for display without duplicating the primary id", () => {
    expect(
      getDisplayedBeatAliases({
        id: "foolery-aa57",
        aliases: ["  aa57  ", "project-aa57", "aa57", "", "   "],
      }),
    ).toEqual(["project-aa57"]);
    expect(
      getDisplayedBeatAliases({
        id: "foolery-aa57",
        aliases: ["proj-1234", " proj-5678.3 ", "proj-1234"],
      }),
    ).toEqual(["proj-5678.3"]);
  });

  it("returns an empty list when no aliases are present", () => {
    expect(getDisplayedBeatAliases(null)).toEqual([]);
    expect(getDisplayedBeatAliases({ id: "foolery-aa57", aliases: undefined })).toEqual([]);
  });
});
