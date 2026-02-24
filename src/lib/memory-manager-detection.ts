import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  listKnownMemoryManagers,
  type MemoryManagerType,
} from "@/lib/memory-managers";

export function detectMemoryManagerType(repoPath: string): MemoryManagerType | undefined {
  for (const memoryManager of listKnownMemoryManagers()) {
    if (existsSync(join(repoPath, memoryManager.markerDirectory))) {
      return memoryManager.type;
    }
  }
  return undefined;
}
