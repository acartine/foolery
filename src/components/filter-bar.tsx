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
import { X } from "lucide-react";
import type { UpdateBeatInput } from "@/lib/schemas";
import { BulkEditControls } from "@/components/bulk/bulk-edit-controls";
import {
  formatLabel,
  commonTypes,
  QUEUE_STATES,
  ACTIVE_STATES,
  collectBulkSetStateOptions,
  type ViewPhase,
} from "@/components/bulk/bulk-edit-shared";

export type { ViewPhase };
// Re-exported for the hermetic descriptor test (see
// __tests__/bulk-edit-terminal-states.test.ts).
export { collectBulkSetStateOptions };

interface FilterBarProps {
  viewPhase?: ViewPhase;
  selectedIds?: string[];
  onBulkUpdate?: (fields: UpdateBeatInput) => void;
  onClearSelection?: () => void;
  onSceneBeats?: (ids: string[]) => void;
  onMergeBeats?: (ids: string[]) => void;
  onRefineScope?: (ids: string[]) => void;
}

function FilterControls({ viewPhase }: { viewPhase?: ViewPhase }) {
  const { filters, activeRepo, registeredRepos } = useAppStore();
  const updateUrl = useUpdateUrl();

  const activeRepoEntry = registeredRepos.find((r) => r.path === activeRepo);
  const isBeadsProject = activeRepoEntry?.memoryManagerType === "beads";

  // Determine the phase-level default and allowed states
  const phaseDefault = viewPhase === "active" ? "in_action" : "queued";
  const phaseStates = viewPhase === "active" ? ACTIVE_STATES : QUEUE_STATES;
  const selectedState =
    filters.state && (filters.state === phaseDefault || phaseStates.includes(filters.state))
      ? filters.state
      : phaseDefault;

  const hasNonDefaultFilters =
    filters.state !== phaseDefault
    || (isBeadsProject && filters.type)
    || filters.priority !== undefined;

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <Select
        value={selectedState}
        onValueChange={(v) => {
          updateUrl({ state: v === phaseDefault ? phaseDefault : v });
          (document.activeElement as HTMLElement)?.blur?.();
        }}
      >
        <SelectTrigger className="w-[220px] h-7">
          <SelectValue placeholder="State" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={phaseDefault}>All</SelectItem>
          {phaseStates.map((s) => (
            <SelectItem key={s} value={s}>
              {formatLabel(s)}
            </SelectItem>
          ))}
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
          onClick={() => updateUrl({ state: phaseDefault, type: undefined, priority: undefined })}
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

export function FilterBar({
  viewPhase,
  selectedIds,
  onBulkUpdate,
  onClearSelection,
  onSceneBeats,
  onMergeBeats,
  onRefineScope,
}: FilterBarProps) {
  if (selectedIds && selectedIds.length > 0 && onBulkUpdate && onClearSelection) {
    return (
      <BulkEditControls
        viewPhase={viewPhase}
        selectedIds={selectedIds}
        onBulkUpdate={onBulkUpdate}
        onClearSelection={onClearSelection}
        onSceneBeats={onSceneBeats}
        onMergeBeats={onMergeBeats}
        onRefineScope={onRefineScope}
      />
    );
  }
  return <FilterControls viewPhase={viewPhase} />;
}
