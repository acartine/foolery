import type { Beat } from "@/lib/types";

export function buildQueueLabelFilterOptions(
  beats: readonly Pick<Beat, "labels">[],
): string[] {
  const labels = new Set<string>();

  for (const beat of beats) {
    for (const label of beat.labels ?? []) {
      const cleaned = label.trim();
      if (cleaned) labels.add(cleaned);
    }
  }

  return [...labels].sort((left, right) =>
    left.localeCompare(right)
  );
}

export function filterBeatsByQueueLabel<T extends Pick<Beat, "labels">>(
  beats: readonly T[],
  selectedLabel: string | null | undefined,
): T[] {
  const label = selectedLabel?.trim();
  if (!label) return [...beats];
  return beats.filter((beat) =>
    beat.labels?.some((beatLabel) => beatLabel.trim() === label)
  );
}
