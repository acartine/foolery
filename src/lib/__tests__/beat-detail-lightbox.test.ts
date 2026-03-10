import { describe, expect, it } from "vitest";
import {
  getDisplayedBeatAliases,
  getDisplayedBeatId,
} from "@/components/beat-detail-lightbox";

describe("beat detail lightbox identity helpers", () => {
  it("shows the natural beat ID for the detail header", () => {
    expect(getDisplayedBeatId("foolery-proj-1234", null)).toBe("proj-1234");
    expect(getDisplayedBeatId("foolery-aa57", { id: "other-bb11" })).toBe("bb11");
  });

  it("normalizes beat aliases to natural IDs for display", () => {
    expect(
      getDisplayedBeatAliases({
        aliases: ["  proj-5678.3  ", "other-proj-5678.3", "proj-5678.3", "", "   "],
      }),
    ).toEqual(["proj-5678.3"]);
  });

  it("returns an empty list when no aliases are present", () => {
    expect(getDisplayedBeatAliases(null)).toEqual([]);
    expect(getDisplayedBeatAliases({ aliases: undefined })).toEqual([]);
  });
});
