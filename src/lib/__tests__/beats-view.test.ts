import { describe, expect, it } from "vitest";

import {
  buildBeatsSearchHref,
  isListBeatsView,
  parseBeatsView,
} from "@/lib/beats-view";

describe("beats view helpers", () => {
  it("parses setlist and search as first-class beats views", () => {
    expect(parseBeatsView("setlist")).toBe("setlist");
    expect(parseBeatsView("overview")).toBe("overview");
    expect(parseBeatsView("search")).toBe("search");
    expect(parseBeatsView("active")).toBe("active");
    expect(parseBeatsView("legacy")).toBe("queues");
    expect(parseBeatsView(null)).toBe("queues");
  });

  it("treats search as a list-capable beats view", () => {
    expect(isListBeatsView("search")).toBe(true);
    expect(isListBeatsView("queues")).toBe(true);
    expect(isListBeatsView("active")).toBe(true);
    expect(isListBeatsView("overview")).toBe(false);
    expect(isListBeatsView("setlist")).toBe(false);
    expect(isListBeatsView("finalcut")).toBe(false);
  });

  it("navigates search submissions into the dedicated search view", () => {
    expect(
      buildBeatsSearchHref(
        "repo=/tmp/repo&state=in_action&beat=beat-12&detailRepo=/tmp/repo",
        " alpha beta ",
      ),
    ).toBe(
      "/beats?repo=%2Ftmp%2Frepo&state=in_action"
      + "&beat=beat-12&detailRepo=%2Ftmp%2Frepo"
      + "&q=alpha+beta&view=search",
    );
  });

  it("clears search without leaving the user stuck in search view", () => {
    expect(
      buildBeatsSearchHref("repo=/tmp/repo&view=search&q=alpha+beta", ""),
    ).toBe("/beats?repo=%2Ftmp%2Frepo");
  });

  it("preserves non-search views when clearing a header query", () => {
    expect(
      buildBeatsSearchHref("repo=/tmp/repo&view=finalcut&q=alpha+beta", ""),
    ).toBe("/beats?repo=%2Ftmp%2Frepo&view=finalcut");
  });
});
