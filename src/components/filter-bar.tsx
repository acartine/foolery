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
import { X, Clapperboard, Merge } from "lucide-react";
import type { BeatPriority } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { builtinWorkflowDescriptors } from "@/lib/workflows";

const commonTypes: string[] = [
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "work",
];

function formatLabel(val: string): string {
  return val
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface FilterBarProps {
  selectedIds?: string[];
  onBulkUpdate?: (fields: UpdateBeatInput) => void;
  onClearSelection?: () => void;
  onSceneBeads?: (ids: string[]) => void;
  onMergeBeads?: (ids: string[]) => void;
}

export function BulkEditControls({
  selectedIds,
  onBulkUpdate,
  onClearSelection,
  onSceneBeads,
  onMergeBeads,
}: Required<Pick<FilterBarProps, "selectedIds" | "onBulkUpdate" | "onClearSelection">> &
  Pick<FilterBarProps, "onSceneBeads" | "onMergeBeads">) {
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
      {onMergeBeads && selectedIds.length === 2 && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          title="Merge two beats into one"
          onClick={() => onMergeBeads(selectedIds)}
        >
          <Merge className="h-3.5 w-3.5" />
          Merge
        </Button>
      )}
      <Select
        onValueChange={(v) => onBulkUpdate({ type: v })}
      >
        <SelectTrigger className="w-[130px] h-7">
          <SelectValue placeholder="Set type..." />
        </SelectTrigger>
        <SelectContent>
          {commonTypes.map((t) => (
            <SelectItem key={t} value={t}>
              {formatLabel(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        onValueChange={(v) =>
          onBulkUpdate({ priority: Number(v) as BeatPriority })
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
        onValueChange={(v) => onBulkUpdate({ profileId: v })}
      >
        <SelectTrigger className="w-[130px] h-7">
          <SelectValue placeholder="Set profile..." />
        </SelectTrigger>
        <SelectContent>
          {builtinWorkflowDescriptors().map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {formatLabel(p.id)}
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
  const { filters, activeRepo, registeredRepos } = useAppStore();
  const updateUrl = useUpdateUrl();

  const activeRepoEntry = registeredRepos.find((r) => r.path === activeRepo);
  const isBeadsProject = activeRepoEntry?.memoryManagerType === "beads";

  const hasNonDefaultFilters =
    filters.state !== "queued" || (isBeadsProject && filters.type) || filters.priority !== undefined;

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <Select
        value={filters.state ?? "all"}
        onValueChange={(v) => {
          updateUrl({ state: v === "all" ? undefined : v });
          (document.activeElement as HTMLElement)?.blur?.();
        }}
      >
        <SelectTrigger className="w-[140px] h-7">
          <SelectValue placeholder="State" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="queued">Queued</SelectItem>
          <SelectItem value="in_action">In Action</SelectItem>
          <SelectItem value="all">All States</SelectItem>
        </SelectContent>
      </Select>

      {isBeadsProject && (
        <Select
          value={filters.type ?? "all"}
          onValueChange={(v) => {
            updateUrl({ type: v === "all" ? undefined : v });
            (document.activeElement as HTMLElement)?.blur?.();
          }}
        >
          <SelectTrigger className="w-[140px] h-7">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {commonTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {formatLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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
          onClick={() => updateUrl({ state: "queued", type: undefined, priority: undefined })}
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
  onMergeBeads,
}: FilterBarProps) {
  if (selectedIds && selectedIds.length > 0 && onBulkUpdate && onClearSelection) {
    return (
      <BulkEditControls
        selectedIds={selectedIds}
        onBulkUpdate={onBulkUpdate}
        onClearSelection={onClearSelection}
        onSceneBeads={onSceneBeads}
        onMergeBeads={onMergeBeads}
      />
    );
  }
  return <FilterControls />;
}
