"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/stores/app-store";

const VALID_PAGE_SIZES = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

export function UrlStateSync() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const store = useAppStore.getState();

    // Sync activeRepo
    const urlRepo = searchParams.get("repo");
    if (urlRepo !== store.activeRepo) {
      store.setActiveRepo(urlRepo);
    }

    // Sync filters
    const urlState = searchParams.get("state");
    const urlType = searchParams.get("type");
    const urlPriority = searchParams.get("priority");
    const urlAssignee = searchParams.get("assignee");

    const newState = urlState === "all"
      ? undefined
      : urlState
        ? urlState
        : "queued";
    const newType = urlType || undefined;
    const newPriority = urlPriority !== null
      ? Number(urlPriority)
      : undefined;
    const newAssignee = urlAssignee || undefined;

    const filtersChanged =
      newState !== store.filters.state ||
      newType !== store.filters.type ||
      newPriority !== store.filters.priority ||
      newAssignee !== store.filters.assignee;

    if (filtersChanged) {
      store.setFiltersFromUrl({
        state: newState,
        type: newType,
        priority: newPriority,
        assignee: newAssignee,
      });
    }

    // Sync pageSize
    const urlPageSize = searchParams.get("pageSize");
    const parsedSize = urlPageSize ? Number(urlPageSize) : DEFAULT_PAGE_SIZE;
    const validSize = VALID_PAGE_SIZES.includes(parsedSize) ? parsedSize : DEFAULT_PAGE_SIZE;
    if (validSize !== store.pageSize) {
      store.setPageSize(validSize);
    }
  }, [searchParams]);

  return null;
}
