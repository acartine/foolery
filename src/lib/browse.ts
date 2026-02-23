import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { IssueTrackerType } from "@/lib/issue-trackers";
import { detectIssueTrackerType } from "@/lib/issue-tracker-detection";

export interface DirEntry {
  name: string;
  path: string;
  trackerType?: IssueTrackerType;
  isCompatible: boolean;
}

export async function listDirectory(dirPath?: string): Promise<DirEntry[]> {
  const target = dirPath || homedir();
  const entries: DirEntry[] = [];

  let dirents;
  try {
    dirents = await readdir(target, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name.startsWith(".")) continue;

    const fullPath = join(target, dirent.name);

    try {
      await stat(fullPath);
      const trackerType = detectIssueTrackerType(fullPath);
      entries.push({
        name: dirent.name,
        path: fullPath,
        trackerType,
        isCompatible: Boolean(trackerType),
      });
    } catch {
      // permission error or similar, skip
    }
  }

  entries.sort((a, b) => {
    if (a.isCompatible !== b.isCompatible) return a.isCompatible ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}
