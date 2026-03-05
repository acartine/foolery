import { describe, expect, it } from "vitest";
import { buildBeatFocusHref, stripBeatPrefix } from "@/lib/beat-navigation";

describe("stripBeatPrefix", () => {
  it("removes the leading repo prefix from beat id", () => {
    expect(stripBeatPrefix("foolery-xmvb")).toBe("xmvb");
  });

  it("returns original value when no hyphen exists", () => {
    expect(stripBeatPrefix("xmvb")).toBe("xmvb");
  });
});

describe("buildBeatFocusHref", () => {
  it("sets beat while preserving existing query params", () => {
    expect(buildBeatFocusHref("foolery-xmvb", "repo=/tmp/repo&view=finalcut")).toBe(
      "/beats?repo=%2Ftmp%2Frepo&view=finalcut&beat=foolery-xmvb",
    );
  });

  it("updates detailRepo when provided", () => {
    expect(
      buildBeatFocusHref("foolery-xmvb", "repo=one", {
        detailRepo: "/tmp/repo",
      }),
    ).toBe("/beats?repo=one&beat=foolery-xmvb&detailRepo=%2Ftmp%2Frepo");
  });
});
