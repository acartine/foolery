import { describe, expect, it } from "vitest";
import { splitTerminalTabBeatId } from "@/lib/terminal-tab-id";

describe("splitTerminalTabBeatId", () => {
  it("returns prefix and local id for repo-prefixed beat ids", () => {
    expect(splitTerminalTabBeatId("foolery-da96")).toEqual({
      prefix: "foolery",
      localId: "da96",
    });
  });

  it("returns the raw id as localId when no valid prefix is present", () => {
    expect(splitTerminalTabBeatId("da96")).toEqual({
      prefix: null,
      localId: "da96",
    });
    expect(splitTerminalTabBeatId("-da96")).toEqual({
      prefix: null,
      localId: "-da96",
    });
    expect(splitTerminalTabBeatId("foolery-")).toEqual({
      prefix: null,
      localId: "foolery-",
    });
  });
});
