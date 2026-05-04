"use client";

import { useEffect, useState } from "react";
import {
  nextOverviewSizingColumnCount,
  nextOverviewSizingColumnCounts,
} from "@/lib/beat-state-overview";
import type {
  OverviewSizingColumnCounts,
  OverviewStateTabId,
} from "@/lib/beat-state-overview";

export function useOverviewColumnWatermark({
  tabId,
  visibleColumnCount,
}: {
  tabId: OverviewStateTabId;
  visibleColumnCount: number;
}): number {
  const [counts, setCounts] = useState<OverviewSizingColumnCounts>({});
  const count = nextOverviewSizingColumnCount(
    counts[tabId],
    visibleColumnCount,
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCounts((current) =>
        nextOverviewSizingColumnCounts(
          current,
          tabId,
          visibleColumnCount,
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tabId, visibleColumnCount]);

  return count;
}
