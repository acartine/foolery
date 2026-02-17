"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/stores/app-store";
import type { BeadStatus, BeadType, BeadPriority } from "@/lib/types";

const VALID_PAGE_SIZES = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

const VALID_STATUSES = new Set<string>([
  "open", "in_progress", "blocked", "deferred", "closed", "ready", "all",
]);

const VALID_TYPES = new Set<string>([
  "bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate",
]);

export function UrlStateSync() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const store = useAppStore.getState();

    // Sync activeRepo -- only override store when URL explicitly has ?repo=
    const urlRepo = searchParams.get("repo");
    if (searchParams.has("repo") && urlRepo !== store.activeRepo) {
      store.setActiveRepo(urlRepo);
    }

    // Sync filters
    const urlStatus = searchParams.get("status");
    const urlType = searchParams.get("type");
    const urlPriority = searchParams.get("priority");
    const urlAssignee = searchParams.get("assignee");

    const newStatus = urlStatus === "all"
      ? undefined
      : urlStatus && VALID_STATUSES.has(urlStatus)
        ? (urlStatus as BeadStatus | "ready")
        : "ready";
    const newType = urlType && VALID_TYPES.has(urlType)
      ? (urlType as BeadType)
      : undefined;
    const newPriority = urlPriority !== null
      ? (Number(urlPriority) as BeadPriority)
      : undefined;
    const newAssignee = urlAssignee || undefined;

    const filtersChanged =
      newStatus !== store.filters.status ||
      newType !== store.filters.type ||
      newPriority !== store.filters.priority ||
      newAssignee !== store.filters.assignee;

    if (filtersChanged) {
      store.setFiltersFromUrl({
        status: newStatus,
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
