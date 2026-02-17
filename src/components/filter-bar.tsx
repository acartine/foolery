"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import { X, Clapperboard } from "lucide-react";
import type { BeadStatus, BeadType, BeadPriority } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";

const statuses: BeadStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
];
const types: BeadType[] = [
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "merge-request",
  "molecule",
  "gate",
];

function formatLabel(val: string): string {
  return val
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface FilterBarProps {
  selectedIds?: string[];
  onBulkUpdate?: (fields: UpdateBeadInput) => void;
  onClearSelection?: () => void;
  onSceneBeads?: (ids: string[]) => void;
}

export function BulkEditControls({
  selectedIds,
  onBulkUpdate,
  onClearSelection,
  onSceneBeads,
}: Required<Pick<FilterBarProps, "selectedIds" | "onBulkUpdate" | "onClearSelection">> &
  Pick<FilterBarProps, "onSceneBeads">) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedIds.length} selected
      </span>
      {onSceneBeads && selectedIds.length >= 2 && (
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          title="Group selected beats into a scene"
          onClick={() => onSceneBeads(selectedIds)}
        >
          <Clapperboard className="h-3.5 w-3.5" />
          Scene!
        </Button>
      )}
      <Select
        onValueChange={(v) => onBulkUpdate({ type: v as BeadType })}
      >
        <SelectTrigger className="w-[130px] h-7">
          <SelectValue placeholder="Set type..." />
        </SelectTrigger>
        <SelectContent>
          {types.map((t) => (
            <SelectItem key={t} value={t}>
              {formatLabel(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        onValueChange={(v) =>
          onBulkUpdate({ priority: Number(v) as BeadPriority })
        }
      >
        <SelectTrigger className="w-[130px] h-7">
          <SelectValue placeholder="Set priority..." />
        </SelectTrigger>
        <SelectContent>
          {([0, 1, 2, 3, 4] as const).map((p) => (
            <SelectItem key={p} value={String(p)}>
              P{p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        onValueChange={(v) => onBulkUpdate({ status: v as BeadStatus })}
      >
        <SelectTrigger className="w-[130px] h-7">
          <SelectValue placeholder="Set status..." />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {formatLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" title="Clear selection" onClick={onClearSelection}>
        <X className="h-4 w-4 mr-1" />
        Clear
      </Button>
    </div>
  );
}

function FilterControls() {
  const { filters } = useAppStore();
  const updateUrl = useUpdateUrl();

  const hasNonDefaultFilters =
    filters.status !== "ready" || filters.type || filters.priority !== undefined;

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <Select
        value={filters.status ?? "all"}
        onValueChange={(v) => {
          updateUrl({ status: v === "all" ? undefined : (v as BeadStatus | "ready") });
          (document.activeElement as HTMLElement)?.blur?.();
        }}
      >
        <SelectTrigger className="w-[140px] h-7">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="ready">Ready</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {formatLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.type ?? "all"}
        onValueChange={(v) => {
          updateUrl({ type: v === "all" ? undefined : (v as BeadType) });
          (document.activeElement as HTMLElement)?.blur?.();
        }}
      >
        <SelectTrigger className="w-[140px] h-7">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          {types.map((t) => (
            <SelectItem key={t} value={t}>
              {formatLabel(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.priority !== undefined ? String(filters.priority) : "all"}
        onValueChange={(v) => {
          updateUrl({
            priority: v === "all" ? undefined : (Number(v) as 0 | 1 | 2 | 3 | 4),
          });
          (document.activeElement as HTMLElement)?.blur?.();
        }}
      >
        <SelectTrigger className="w-[140px] h-7">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priorities</SelectItem>
          {([0, 1, 2, 3, 4] as const).map((p) => (
            <SelectItem key={p} value={String(p)}>
              P{p} - {["Critical", "High", "Medium", "Low", "Trivial"][p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasNonDefaultFilters && (
        <Button
          variant="ghost"
          size="sm"
          title="Clear all filters"
          onClick={() => updateUrl({ status: "ready", type: undefined, priority: undefined })}
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

export function FilterBar({
  selectedIds,
  onBulkUpdate,
  onClearSelection,
  onSceneBeads,
}: FilterBarProps) {
  if (selectedIds && selectedIds.length > 0 && onBulkUpdate && onClearSelection) {
    return (
      <BulkEditControls
        selectedIds={selectedIds}
        onBulkUpdate={onBulkUpdate}
        onClearSelection={onClearSelection}
        onSceneBeads={onSceneBeads}
      />
    );
  }
  return <FilterControls />;
}
