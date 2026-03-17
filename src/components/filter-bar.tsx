"use client";

import { useState } from "react";
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
import { builtinWorkflowDescriptors, compareWorkflowStatePriority } from "@/lib/workflows";

const commonTypes: string[] = [
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "work",
];

const bulkTerminalStates = [
  { value: "shipped", label: "Shipped" },
  { value: "abandoned", label: "Abandoned" },
  { value: "deferred", label: "Deferred" },
] as const;

function formatLabel(val: string): string {
  return val
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type ViewPhase = "queues" | "active";

const FALLBACK_QUEUE_STATES = [
  "ready_for_planning",
  "ready_for_plan_review",
  "ready_for_implementation",
  "ready_for_implementation_review",
  "ready_for_shipment",
  "ready_for_shipment_review",
] as const;

const FALLBACK_ACTIVE_STATES = [
  "planning",
  "plan_review",
  "implementation",
  "implementation_review",
  "shipment",
  "shipment_review",
] as const;

function collectPhaseStates(phase: ViewPhase, fallbackStates: readonly string[]): string[] {
  const states = new Set<string>();

  for (const workflow of builtinWorkflowDescriptors()) {
    const phaseStates = phase === "active" ? workflow.actionStates : workflow.queueStates;
    for (const state of phaseStates ?? []) {
      states.add(state);
    }
  }

  if (states.size === 0) {
    return [...fallbackStates].sort(compareWorkflowStatePriority);
  }

  return [...states].sort(compareWorkflowStatePriority);
}

const QUEUE_STATES = collectPhaseStates("queues", FALLBACK_QUEUE_STATES);
const ACTIVE_STATES = collectPhaseStates("active", FALLBACK_ACTIVE_STATES);

interface FilterBarProps {
  viewPhase?: ViewPhase;
  selectedIds?: string[];
  onBulkUpdate?: (fields: UpdateBeatInput) => void;
  onClearSelection?: () => void;
  onSceneBeats?: (ids: string[]) => void;
  onMergeBeats?: (ids: string[]) => void;
}

export function BulkEditControls({
  selectedIds,
  onBulkUpdate,
  onClearSelection,
  onSceneBeats,
  onMergeBeats,
}: Required<Pick<FilterBarProps, "selectedIds" | "onBulkUpdate" | "onClearSelection">> &
  Pick<FilterBarProps, "onSceneBeats" | "onMergeBeats">) {
  const [bulkStateSelectKey, setBulkStateSelectKey] = useState(0);

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedIds.length} selected
      </span>
      {onSceneBeats && selectedIds.length >= 2 && (
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          title="Group selected beats into a scene"
          onClick={() => onSceneBeats(selectedIds)}
        >
          <Clapperboard className="h-3.5 w-3.5" />
          Scene!
        </Button>
      )}
      {onMergeBeats && selectedIds.length === 2 && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          title="Merge two beats into one"
          onClick={() => onMergeBeats(selectedIds)}
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
      <Select
        key={bulkStateSelectKey}
        onValueChange={(v) => {
          onBulkUpdate({ state: v });
          setBulkStateSelectKey((key) => key + 1);
        }}
      >
        <SelectTrigger className="w-[130px] h-7">
          <SelectValue placeholder="Set state..." />
        </SelectTrigger>
        <SelectContent>
          {bulkTerminalStates.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
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
    filters.state !== phaseDefault || (isBeadsProject && filters.type) || filters.priority !== undefined;

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
}: FilterBarProps) {
  if (selectedIds && selectedIds.length > 0 && onBulkUpdate && onClearSelection) {
    return (
      <BulkEditControls
        selectedIds={selectedIds}
        onBulkUpdate={onBulkUpdate}
        onClearSelection={onClearSelection}
        onSceneBeats={onSceneBeats}
        onMergeBeats={onMergeBeats}
      />
    );
  }
  return <FilterControls viewPhase={viewPhase} />;
}
