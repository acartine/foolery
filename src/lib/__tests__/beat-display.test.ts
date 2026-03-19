import { describe, expect, it } from "vitest";
import {
  displayBeatLabel,
  firstBeatAlias,
  stripHierarchicalPrefix,
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

  it("strips project prefixes from hierarchical aliases", () => {
    expect(displayBeatLabel("knots-562b.1", ["knots-562b.1"])).toBe("562b.1");
    expect(stripHierarchicalPrefix("proj-a.b.c")).toBe("a.b.c");
  });

  it("keeps human-friendly aliases unchanged", () => {
    expect(displayBeatLabel("foolery-df3a", ["ship-views"])).toBe("ship-views");
    expect(stripHierarchicalPrefix("ship-views")).toBe("ship-views");
  });

  it("trims aliases before using them", () => {
    expect(firstBeatAlias(["  primary-alias  ", "secondary"])).toBe("primary-alias");
  });
});
