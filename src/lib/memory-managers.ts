/**
 * Known memory manager implementations supported by Foolery.
 *
 * This file is intentionally runtime-agnostic (no node:fs imports) so it can
 * be used by both server and client code.
 */

export type MemoryManagerType = "beads" | "knots";

export interface MemoryManagerImplementation {
  type: MemoryManagerType;
  label: string;
  markerDirectory: string;
}

const KNOWN_MEMORY_MANAGERS: ReadonlyArray<MemoryManagerImplementation> = Object.freeze([
  {
    type: "knots",
    label: "Knots",
    markerDirectory: ".knots",
  },
  {
    type: "beads",
    label: "Beads",
    markerDirectory: ".beads",
  },
]);

const KNOWN_MEMORY_MANAGER_BY_TYPE = new Map<MemoryManagerType, MemoryManagerImplementation>(
  KNOWN_MEMORY_MANAGERS.map((memoryManager) => [memoryManager.type, memoryManager]),
);

export function listKnownMemoryManagers(): ReadonlyArray<MemoryManagerImplementation> {
  return KNOWN_MEMORY_MANAGERS;
}

export function isKnownMemoryManagerType(value: string | undefined): value is MemoryManagerType {
  if (!value) return false;
  return KNOWN_MEMORY_MANAGER_BY_TYPE.has(value as MemoryManagerType);
}

export function getMemoryManagerLabel(type: string | undefined): string {
  if (!isKnownMemoryManagerType(type)) return "Unknown";
  return KNOWN_MEMORY_MANAGER_BY_TYPE.get(type)!.label;
}

export function getKnownMemoryManagerMarkers(): string[] {
  return KNOWN_MEMORY_MANAGERS.map((memoryManager) => memoryManager.markerDirectory);
}
