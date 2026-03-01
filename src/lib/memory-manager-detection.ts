import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  listKnownMemoryManagers,
  type MemoryManagerType,
} from "@/lib/memory-managers";

export function detectMemoryManagerType(repoPath: string): MemoryManagerType | undefined {
  const sorted = [...listKnownMemoryManagers()].sort((a, b) => a.precedence - b.precedence);
  for (const memoryManager of sorted) {
    if (existsSync(join(repoPath, memoryManager.markerDirectory))) {
      return memoryManager.type;
    }
  }
  return undefined;
}
