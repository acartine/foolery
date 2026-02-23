/**
 * Known issue tracker implementations supported by Foolery.
 *
 * This file is intentionally runtime-agnostic (no node:fs imports) so it can
 * be used by both server and client code.
 */

export type IssueTrackerType = "beads";

export interface IssueTrackerImplementation {
  type: IssueTrackerType;
  label: string;
  markerDirectory: string;
}

const KNOWN_ISSUE_TRACKERS: ReadonlyArray<IssueTrackerImplementation> = Object.freeze([
  {
    type: "beads",
    label: "Beads",
    markerDirectory: ".beads",
  },
]);

const KNOWN_TRACKER_BY_TYPE = new Map<IssueTrackerType, IssueTrackerImplementation>(
  KNOWN_ISSUE_TRACKERS.map((tracker) => [tracker.type, tracker]),
);

export function listKnownIssueTrackers(): ReadonlyArray<IssueTrackerImplementation> {
  return KNOWN_ISSUE_TRACKERS;
}

export function isKnownIssueTrackerType(value: string | undefined): value is IssueTrackerType {
  if (!value) return false;
  return KNOWN_TRACKER_BY_TYPE.has(value as IssueTrackerType);
}

export function getIssueTrackerLabel(type: string | undefined): string {
  if (!isKnownIssueTrackerType(type)) return "Unknown";
  return KNOWN_TRACKER_BY_TYPE.get(type)!.label;
}

export function getKnownTrackerMarkers(): string[] {
  return KNOWN_ISSUE_TRACKERS.map((tracker) => tracker.markerDirectory);
}
