"use client";

import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useAppStore, type Filters } from "@/stores/app-store";
import type { BeadStatus, BeadType, BeadPriority } from "@/lib/types";

const DEFAULT_PAGE_SIZE = 50;
const VALID_PAGE_SIZES = [25, 50, 100];

interface UrlOverrides {
  repo?: string | null;
  status?: BeadStatus | "ready" | undefined;
  type?: BeadType | undefined;
  priority?: BeadPriority | undefined;
  assignee?: string | undefined;
  pageSize?: number;
}

export function useUpdateUrl() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (overrides: UrlOverrides) => {
      const store = useAppStore.getState();
      const params = new URLSearchParams(searchParams.toString());

      const repo = "repo" in overrides ? overrides.repo : store.activeRepo;
      const status = "status" in overrides ? overrides.status : store.filters.status;
      const type = "type" in overrides ? overrides.type : store.filters.type;
      const priority = "priority" in overrides ? overrides.priority : store.filters.priority;
      const assignee = "assignee" in overrides ? overrides.assignee : store.filters.assignee;
      const pageSize = "pageSize" in overrides ? overrides.pageSize : store.pageSize;

      if (repo) params.set("repo", repo);
      else params.delete("repo");

      if (status) params.set("status", status);
      else params.delete("status");

      if (type) params.set("type", type);
      else params.delete("type");

      if (priority !== undefined) params.set("priority", String(priority));
      else params.delete("priority");

      if (assignee) params.set("assignee", assignee);
      else params.delete("assignee");

      if (pageSize && pageSize !== DEFAULT_PAGE_SIZE && VALID_PAGE_SIZES.includes(pageSize))
        params.set("pageSize", String(pageSize));
      else params.delete("pageSize");

      // Update Zustand immediately for instant reactivity
      if ("repo" in overrides) store.setActiveRepo(overrides.repo ?? null);

      if ("status" in overrides || "type" in overrides || "priority" in overrides || "assignee" in overrides) {
        const newFilters: Filters = {
          status: "status" in overrides ? overrides.status : store.filters.status,
          type: "type" in overrides ? overrides.type : store.filters.type,
          priority: "priority" in overrides ? overrides.priority : store.filters.priority,
          assignee: "assignee" in overrides ? overrides.assignee : store.filters.assignee,
        };
        store.setFiltersFromUrl(newFilters);
      }

      if ("pageSize" in overrides && overrides.pageSize !== undefined) {
        store.setPageSize(
          VALID_PAGE_SIZES.includes(overrides.pageSize) ? overrides.pageSize : DEFAULT_PAGE_SIZE
        );
      }

      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    },
    [searchParams, router, pathname],
  );
}
