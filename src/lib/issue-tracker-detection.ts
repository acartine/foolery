import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  listKnownIssueTrackers,
  type IssueTrackerType,
} from "@/lib/issue-trackers";

export function detectIssueTrackerType(repoPath: string): IssueTrackerType | undefined {
  for (const tracker of listKnownIssueTrackers()) {
    if (existsSync(join(repoPath, tracker.markerDirectory))) {
      return tracker.type;
    }
  }
  return undefined;
}
