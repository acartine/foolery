import { describe, expect, it } from "vitest";
import {
  buildBeatFocusHref,
  extractBeatPrefix,
  findRepoForBeatId,
  stripBeatPrefix,
} from "@/lib/beat-navigation";

describe("stripBeatPrefix", () => {
  it("removes the leading repo prefix from beat id", () => {
    expect(stripBeatPrefix("foolery-xmvb")).toBe("xmvb");
  });

  it("returns original value when no hyphen exists", () => {
    expect(stripBeatPrefix("xmvb")).toBe("xmvb");
  });
});

describe("extractBeatPrefix", () => {
  it("extracts the repo prefix from a beat id", () => {
    expect(extractBeatPrefix("foolery-xmvb")).toBe("foolery");
  });

  it("returns null when no hyphen exists", () => {
    expect(extractBeatPrefix("xmvb")).toBeNull();
  });

  it("extracts prefix from multi-hyphen ids", () => {
    expect(extractBeatPrefix("my-project-abc")).toBe("my");
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

  it("overrides repo when provided", () => {
    expect(
      buildBeatFocusHref("foolery-xmvb", "repo=old&view=queues", {
        repo: "/tmp/new",
      }),
    ).toBe("/beats?repo=%2Ftmp%2Fnew&view=queues&beat=foolery-xmvb");
  });

  it("clears repo when explicitly set to null", () => {
    expect(
      buildBeatFocusHref("foolery-xmvb", "repo=/tmp/old&view=queues", {
        repo: null,
      }),
    ).toBe("/beats?view=queues&beat=foolery-xmvb");
  });
});

describe("findRepoForBeatId", () => {
  it("returns matching repo by beat id prefix", () => {
    expect(
      findRepoForBeatId("foolery-xmvb", [
        { name: "foolery", path: "/repos/foolery" },
        { name: "other", path: "/repos/other" },
      ]),
    ).toEqual({ name: "foolery", path: "/repos/foolery" });
  });

  it("prefers the longest matching prefix", () => {
    expect(
      findRepoForBeatId("my-project-123", [
        { name: "my", path: "/repos/my" },
        { name: "my-project", path: "/repos/my-project" },
      ]),
    ).toEqual({ name: "my-project", path: "/repos/my-project" });
  });

  it("returns null when no repo matches", () => {
    expect(
      findRepoForBeatId("unowned-123", [{ name: "foolery", path: "/repos/foolery" }]),
    ).toBeNull();
  });
});
