"use client";

import { useMemo, useState } from "react";
import {
  buildQueueLabelFilterOptions,
  filterBeatsByQueueLabel,
} from "@/lib/queue-label-filter";
import type { Beat } from "@/lib/types";

export function useQueueLabelFilter(
  beats: Beat[],
  enabled: boolean,
) {
  const [selectedLabel, setSelectedLabel] =
    useState<string | null>(null);
  const options = useMemo(
    () => enabled ? buildQueueLabelFilterOptions(beats) : [],
    [beats, enabled],
  );
  const activeSelectedLabel =
    selectedLabel && options.includes(selectedLabel)
      ? selectedLabel
      : null;
  const filteredBeats = useMemo(
    () => enabled
      ? filterBeatsByQueueLabel(beats, activeSelectedLabel)
      : beats,
    [activeSelectedLabel, beats, enabled],
  );

  return {
    options,
    selectedLabel: enabled ? activeSelectedLabel : null,
    setSelectedLabel,
    filteredBeats,
  };
}
