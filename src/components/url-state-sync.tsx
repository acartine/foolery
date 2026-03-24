"use client";

import { useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useAppStore, getPersistedRepoSelection } from "@/stores/app-store";

const VALID_PAGE_SIZES = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

export function UrlStateSync() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const restoredRef = useRef(false);

  useEffect(() => {
    const store = useAppStore.getState();

    // Sync activeRepo
    const urlRepo = searchParams.get("repo");

    if (!urlRepo && !restoredRef.current) {
      // No repo in URL on initial load — try to restore from localStorage
      restoredRef.current = true;
      const persisted = getPersistedRepoSelection();
      if (persisted?.kind === "repo") {
        if (persisted.path !== store.activeRepo) {
          store.setActiveRepo(persisted.path);
        }
        // Update URL to include the restored repo
        const params = new URLSearchParams(searchParams.toString());
        params.set("repo", persisted.path);
        router.replace(`${pathname}?${params.toString()}`);
        return; // URL change will re-trigger this effect
      }
      if (persisted?.kind === "all" && store.activeRepo !== null) {
        store.setActiveRepo(null);
      }
    } else if (urlRepo !== store.activeRepo) {
      restoredRef.current = true;
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
  }, [searchParams, router, pathname]);

  return null;
}
