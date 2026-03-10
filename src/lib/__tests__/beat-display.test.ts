import { describe, expect, it } from "vitest";
import {
  displayBeatLabel,
  firstBeatAlias,
  stripBeatPrefix,
} from "@/lib/beat-display";

describe("beat-display", () => {
  it("prefers the first alias when one exists", () => {
    expect(displayBeatLabel("foolery-df3a", ["ship-views", "df3a"])).toBe("ship-views");
  });

  it("falls back to the stripped beat id when aliases are missing", () => {
    expect(displayBeatLabel("foolery-df3a")).toBe("df3a");
    expect(displayBeatLabel("foolery-df3a", [])).toBe("df3a");
    expect(stripBeatPrefix("foolery-df3a")).toBe("df3a");
  });

  it("trims aliases before using them", () => {
    expect(firstBeatAlias(["  primary-alias  ", "secondary"])).toBe("primary-alias");
  });
});
