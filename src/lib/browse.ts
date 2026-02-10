import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DirEntry {
  name: string;
  path: string;
  isBeadsRepo: boolean;
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
      const isBeadsRepo = existsSync(join(fullPath, ".beads"));
      entries.push({ name: dirent.name, path: fullPath, isBeadsRepo });
    } catch {
      // permission error or similar, skip
    }
  }

  entries.sort((a, b) => {
    if (a.isBeadsRepo !== b.isBeadsRepo) return a.isBeadsRepo ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}
