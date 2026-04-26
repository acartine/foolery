"use client";

import { useState, useCallback } from "react";
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
import {
  X,
  Clapperboard,
  Merge,
  Check,
  RefreshCw,
} from "lucide-react";
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

function formatLabel(val: string): string {
  return val
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type ViewPhase = "queues" | "active";

/**
 * Collect the union of either `queueStates` or `actionStates` across
 * all builtin workflow descriptors. State classification is sourced
 * from the loom-derived descriptor, never hardcoded — see CLAUDE.md
 * §"State Classification Is Loom-Derived". Throws loud if descriptors
 * are missing the field, rather than coalescing to a hardcoded default
 * that would silently mask a builtin-catalog regression.
 */
function collectPhaseStates(phase: ViewPhase): string[] {
  const states = new Set<string>();
  for (const workflow of builtinWorkflowDescriptors()) {
    const phaseStates = phase === "active"
      ? workflow.actionStates
      : workflow.queueStates;
    for (const state of phaseStates ?? []) {
      states.add(state);
    }
  }
  if (states.size === 0) {
    throw new Error(
      `FOOLERY DESCRIPTOR FAILURE: no ${phase} states found across `
      + "builtin workflow descriptors. Caller cannot proceed without "
      + "a loom-derived state list; refusing to fall back to a "
      + "hardcoded default that would mask the regression.",
    );
  }
  return [...states].sort(compareWorkflowStatePriority);
}

/**
 * Bulk-edit "Set state" dropdown options: states a user can move
 * many beats to at once. Sourced from the loom-derived descriptors —
 * union of `terminalStates` plus any wildcard transition targets
 * (e.g. `* -> deferred`). Never hardcoded.
 *
 * @internal Exported for testing only.
 */
export function collectBulkSetStateOptions(): Array<{ value: string; label: string }> {
  const targets = new Set<string>();
  for (const workflow of builtinWorkflowDescriptors()) {
    for (const terminal of workflow.terminalStates ?? []) {
      targets.add(terminal);
    }
    for (const transition of workflow.transitions ?? []) {
      if (transition.from === "*") {
        targets.add(transition.to);
      }
    }
  }
  if (targets.size === 0) {
    throw new Error(
      "FOOLERY DESCRIPTOR FAILURE: no terminal or wildcard-target "
      + "states found across builtin workflow descriptors. Bulk "
      + "Set-state dropdown cannot be populated without a loom-"
      + "derived target list.",
    );
  }
  return [...targets]
    .sort(compareWorkflowStatePriority)
    .map((value) => ({ value, label: formatLabel(value) }));
}

const QUEUE_STATES = collectPhaseStates("queues");
const ACTIVE_STATES = collectPhaseStates("active");
const BULK_SET_STATE_OPTIONS = collectBulkSetStateOptions();

const MULTISELECT_BUTTON_CLASS =
  "h-8 gap-1.5 px-2.5";
const MULTISELECT_PRIMARY_CLASS =
  `${MULTISELECT_BUTTON_CLASS} border-primary/25`;
const MULTISELECT_SUCCESS_CLASS =
  `${MULTISELECT_BUTTON_CLASS} border-accent/35`;

interface FilterBarProps {
  viewPhase?: ViewPhase;
  selectedIds?: string[];
  onBulkUpdate?: (fields: UpdateBeatInput) => void;
  onClearSelection?: () => void;
  onSceneBeats?: (ids: string[]) => void;
  onMergeBeats?: (ids: string[]) => void;
  onRefineScope?: (ids: string[]) => void;
}

interface PendingBulkFields {
  type?: string;
  priority?: BeatPriority;
  profileId?: string;
  state?: string;
}

type PendingSetter = React.Dispatch<
  React.SetStateAction<PendingBulkFields>
>;

function BulkTypeSelect(
  { resetKey, setPending }: { resetKey: number; setPending: PendingSetter },
) {
  return (
    <Select
      key={`type-${resetKey}`}
      onValueChange={(v) => setPending((p) => ({ ...p, type: v }))}
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
  );
}

function BulkPrioritySelect(
  { resetKey, setPending }: { resetKey: number; setPending: PendingSetter },
) {
  return (
    <Select
      key={`priority-${resetKey}`}
      onValueChange={(v) =>
        setPending((p) => ({
          ...p,
          priority: Number(v) as BeatPriority,
        }))
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
  );
}

function BulkProfileSelect(
  { resetKey, setPending }: { resetKey: number; setPending: PendingSetter },
) {
  return (
    <Select
      key={`profile-${resetKey}`}
      onValueChange={(v) =>
        setPending((p) => ({ ...p, profileId: v }))
      }
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
  );
}

function BulkStateSelect(
  { resetKey, setPending }: { resetKey: number; setPending: PendingSetter },
) {
  return (
    <Select
      key={`state-${resetKey}`}
      onValueChange={(v) =>
        setPending((p) => ({ ...p, state: v }))
      }
    >
      <SelectTrigger className="w-[130px] h-7">
        <SelectValue placeholder="Set state..." />
      </SelectTrigger>
      <SelectContent>
        {BULK_SET_STATE_OPTIONS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function BulkEditControls({
  viewPhase,
  selectedIds,
  onBulkUpdate,
  onClearSelection,
  onSceneBeats,
  onMergeBeats,
  onRefineScope,
}: Required<
  Pick<FilterBarProps,
    | "selectedIds"
    | "onBulkUpdate"
    | "onClearSelection">
> & Pick<
  FilterBarProps,
  | "viewPhase"
  | "onSceneBeats"
  | "onMergeBeats"
  | "onRefineScope"
>) {
  const [pending, setPending] = useState<PendingBulkFields>({});
  const [resetKey, setResetKey] = useState(0);

  const hasPending = pending.type !== undefined
    || pending.priority !== undefined
    || pending.profileId !== undefined
    || pending.state !== undefined;

  const handleApply = useCallback(() => {
    if (!hasPending) return;
    const fields: UpdateBeatInput = {};
    if (pending.type !== undefined) fields.type = pending.type;
    if (pending.priority !== undefined) fields.priority = pending.priority;
    if (pending.profileId !== undefined) fields.profileId = pending.profileId;
    if (pending.state !== undefined) fields.state = pending.state;
    onBulkUpdate(fields);
    setPending({});
    setResetKey((k) => k + 1);
  }, [hasPending, pending, onBulkUpdate]);

  const handleShip = useCallback(() => {
    // "shipped" is the canonical close-with-success terminal name,
    // matching `KNOTS_CLOSE_TARGET_STATE` in the backend. This is a
    // named action target, not state classification — see CLAUDE.md
    // §"State Classification Is Loom-Derived" (covered by exception:
    // builtin profile vocabulary / canonical action names).
    onBulkUpdate({ state: "shipped" });
    setPending({});
    setResetKey((k) => k + 1);
  }, [onBulkUpdate]);

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedIds.length} selected
      </span>
      <BulkActionButtons
        viewPhase={viewPhase}
        selectedIds={selectedIds}
        onShip={handleShip}
        onSceneBeats={onSceneBeats}
        onMergeBeats={onMergeBeats}
        onRefineScope={onRefineScope}
      />
      <BulkTypeSelect resetKey={resetKey} setPending={setPending} />
      <BulkPrioritySelect resetKey={resetKey} setPending={setPending} />
      <BulkProfileSelect resetKey={resetKey} setPending={setPending} />
      <BulkStateSelect resetKey={resetKey} setPending={setPending} />
      {hasPending && (
        <Button
          variant="secondary"
          size="lg"
          className={MULTISELECT_PRIMARY_CLASS}
          title="Apply changes to selected beats"
          onClick={handleApply}
        >
          <Check className="size-4" />Apply
        </Button>
      )}
      <Button
        variant="ghost"
        size="lg"
        className={MULTISELECT_BUTTON_CLASS}
        title="Clear selection"
        onClick={onClearSelection}
      >
        <X className="size-4" />Clear
      </Button>
    </div>
  );
}

interface BulkActionButtonsProps {
  viewPhase?: ViewPhase;
  selectedIds: string[];
  onShip: () => void;
  onSceneBeats?: (ids: string[]) => void;
  onMergeBeats?: (ids: string[]) => void;
  onRefineScope?: (ids: string[]) => void;
}

function BulkActionButtons(
  {
    viewPhase,
    selectedIds,
    onShip,
    onSceneBeats,
    onMergeBeats,
    onRefineScope,
  }: BulkActionButtonsProps,
) {
  return (
    <>
      {viewPhase === "queues" && (
        <Button
          variant="success-light"
          size="lg"
          className={MULTISELECT_SUCCESS_CLASS}
          title="Ship selected beats"
          onClick={onShip}
        >
          <Check className="size-4" />Ship
        </Button>
      )}
      {onSceneBeats && selectedIds.length >= 2 && (
        <Button
          variant="success-light"
          size="lg"
          className={MULTISELECT_SUCCESS_CLASS}
          title="Group selected beats into a scene"
          onClick={() => onSceneBeats(selectedIds)}
        >
          <Clapperboard className="size-4" />Scene!
        </Button>
      )}
      {onMergeBeats && selectedIds.length === 2 && (
        <Button
          variant="secondary"
          size="lg"
          className={MULTISELECT_PRIMARY_CLASS}
          title="Merge two beats into one"
          onClick={() => onMergeBeats(selectedIds)}
        >
          <Merge className="size-4" />Merge
        </Button>
      )}
      {onRefineScope && (
        <Button
          variant="success-light"
          size="lg"
          className={MULTISELECT_SUCCESS_CLASS}
          title="Re-run scope refinement for selected beats"
          onClick={() => onRefineScope(selectedIds)}
        >
          <RefreshCw className="size-4" />Refine Scope
        </Button>
      )}
    </>
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
