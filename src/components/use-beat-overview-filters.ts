"use client";

import { useCallback, useMemo, useState } from "react";
import {
  buildOverviewTagFilterOptions,
  filterBeatsForOverviewFilters,
} from "@/lib/beat-state-overview-filters";
import type { Beat } from "@/lib/types";
import {
  useOverviewSetlistFilterOptions,
} from "@/components/use-overview-setlist-filter-options";

export function useBeatOverviewFilters(beats: readonly Beat[]) {
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedSetlistIds, setSelectedSetlistIds] = useState<string[]>([]);
  const tagOptions = useMemo(
    () => buildOverviewTagFilterOptions(beats),
    [beats],
  );
  const {
    setlistOptions,
    isLoading: setlistsLoading,
  } = useOverviewSetlistFilterOptions(beats);
  const selectedTagSet = useMemo(
    () => selectedIdSet(selectedTagIds, tagOptions.map((option) => option.id)),
    [selectedTagIds, tagOptions],
  );
  const selectedSetlistSet = useMemo(
    () => selectedIdSet(
      selectedSetlistIds,
      setlistOptions.map((option) => option.id),
    ),
    [selectedSetlistIds, setlistOptions],
  );
  const filteredBeats = useMemo(
    () => filterBeatsForOverviewFilters(beats, {
      selectedTagIds: selectedTagSet,
      selectedSetlistIds: selectedSetlistSet,
      setlistOptions,
    }),
    [beats, selectedSetlistSet, selectedTagSet, setlistOptions],
  );
  const handleTagCheckedChange = useCallback(
    (tagId: string, checked: boolean) => {
      setSelectedTagIds((current) =>
        toggleSelectedId(current, tagId, checked)
      );
    },
    [],
  );
  const handleSetlistCheckedChange = useCallback(
    (setlistId: string, checked: boolean) => {
      setSelectedSetlistIds((current) =>
        toggleSelectedId(current, setlistId, checked)
      );
    },
    [],
  );
  const handleClearFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedSetlistIds([]);
  }, []);

  return {
    tagOptions,
    setlistOptions,
    selectedTagSet,
    selectedSetlistSet,
    setlistsLoading,
    filteredBeats,
    handleTagCheckedChange,
    handleSetlistCheckedChange,
    handleClearFilters,
  };
}

function selectedIdSet(
  selectedIds: readonly string[],
  allowedIds: readonly string[],
): Set<string> {
  const allowed = new Set(allowedIds);
  return new Set(selectedIds.filter((id) => allowed.has(id)));
}

function toggleSelectedId(
  selectedIds: readonly string[],
  id: string,
  checked: boolean,
): string[] {
  if (checked) {
    return selectedIds.includes(id)
      ? [...selectedIds]
      : [...selectedIds, id];
  }
  return selectedIds.filter((selectedId) => selectedId !== id);
}
