import { describe, expect, it } from "vitest";
import {
  getDisplayedBeatAliases,
  getDisplayedBeatId,
} from "@/components/beat-detail-lightbox";

describe("beat detail lightbox identity helpers", () => {
  it("keeps the full beat ID for the detail header", () => {
    expect(getDisplayedBeatId("foolery-aa57", null)).toBe("foolery-aa57");
    expect(getDisplayedBeatId("foolery-aa57", { id: "other-bb11" })).toBe("other-bb11");
  });

  it("normalizes beat aliases for display", () => {
    expect(
      getDisplayedBeatAliases({
        aliases: ["  aa57  ", "project-aa57", "aa57", "", "   "],
      }),
    ).toEqual(["aa57", "project-aa57"]);
  });

  it("returns an empty list when no aliases are present", () => {
    expect(getDisplayedBeatAliases(null)).toEqual([]);
    expect(getDisplayedBeatAliases({ aliases: undefined })).toEqual([]);
  });
});
