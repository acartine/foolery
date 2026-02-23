import { describe, expect, it } from "vitest";
import {
  getIssueTrackerLabel,
  getKnownTrackerMarkers,
  isKnownIssueTrackerType,
  listKnownIssueTrackers,
} from "@/lib/issue-trackers";

describe("issue-trackers", () => {
  it("declares knots as a known tracker", () => {
    const trackers = listKnownIssueTrackers();
    expect(trackers.some((tracker) => tracker.type === "knots")).toBe(true);
  });

  it("declares beads as a known tracker", () => {
    const trackers = listKnownIssueTrackers();
    expect(trackers.some((tracker) => tracker.type === "beads")).toBe(true);
  });

  it("returns a label for known tracker types", () => {
    expect(getIssueTrackerLabel("knots")).toBe("Knots");
    expect(getIssueTrackerLabel("beads")).toBe("Beads");
  });

  it("returns Unknown for unsupported tracker types", () => {
    expect(getIssueTrackerLabel("foo")).toBe("Unknown");
    expect(getIssueTrackerLabel(undefined)).toBe("Unknown");
  });

  it("exposes known marker directory names", () => {
    expect(getKnownTrackerMarkers()).toContain(".knots");
    expect(getKnownTrackerMarkers()).toContain(".beads");
  });

  it("validates known tracker type values", () => {
    expect(isKnownIssueTrackerType("knots")).toBe(true);
    expect(isKnownIssueTrackerType("beads")).toBe(true);
    expect(isKnownIssueTrackerType("foo")).toBe(false);
  });
});
