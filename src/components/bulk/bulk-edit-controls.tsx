"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Clapperboard, Merge, Check, RefreshCw } from "lucide-react";
import type { UpdateBeatInput } from "@/lib/schemas";
import { BulkEditFieldsPopover } from "./bulk-edit-fields-popover";
import {
  MULTISELECT_BUTTON_CLASS,
  MULTISELECT_PRIMARY_CLASS,
  MULTISELECT_SUCCESS_CLASS,
  type ViewPhase,
  type PendingBulkFields,
} from "./bulk-edit-shared";

interface BulkEditControlsProps {
  viewPhase?: ViewPhase;
  selectedIds: string[];
  onBulkUpdate: (fields: UpdateBeatInput) => void;
  onClearSelection: () => void;
  onSceneBeats?: (ids: string[]) => void;
  onMergeBeats?: (ids: string[]) => void;
  onRefineScope?: (ids: string[]) => void;
}

function countPending(pending: PendingBulkFields): number {
  let count = 0;
  if (pending.type !== undefined) count += 1;
  if (pending.priority !== undefined) count += 1;
  if (pending.profileId !== undefined) count += 1;
  if (pending.state !== undefined) count += 1;
  if (pending.labels?.length) count += 1;
  if (pending.removeLabels?.length) count += 1;
  return count;
}

function buildUpdateFields(pending: PendingBulkFields): UpdateBeatInput {
  const fields: UpdateBeatInput = {};
  if (pending.type !== undefined) fields.type = pending.type;
  if (pending.priority !== undefined) fields.priority = pending.priority;
  if (pending.profileId !== undefined) fields.profileId = pending.profileId;
  if (pending.state !== undefined) fields.state = pending.state;
  if (pending.labels?.length) fields.labels = pending.labels;
  if (pending.removeLabels?.length) fields.removeLabels = pending.removeLabels;
  return fields;
}

export function BulkEditControls({
  viewPhase,
  selectedIds,
  onBulkUpdate,
  onClearSelection,
  onSceneBeats,
  onMergeBeats,
  onRefineScope,
}: BulkEditControlsProps) {
  const [pending, setPending] = useState<PendingBulkFields>({});
  const [resetKey, setResetKey] = useState(0);

  const pendingCount = countPending(pending);
  const hasPending = pendingCount > 0;

  const resetPending = useCallback(() => {
    setPending({});
    setResetKey((k) => k + 1);
  }, []);

  const handleApply = useCallback(() => {
    if (!hasPending) return;
    onBulkUpdate(buildUpdateFields(pending));
    resetPending();
  }, [hasPending, pending, onBulkUpdate, resetPending]);

  const handleShip = useCallback(() => {
    // "shipped" is the canonical close-with-success terminal name,
    // matching `KNOTS_CLOSE_TARGET_STATE` in the backend. This is a
    // named action target, not state classification — see CLAUDE.md
    // §"State Classification Is Loom-Derived" (covered by exception:
    // builtin profile vocabulary / canonical action names).
    onBulkUpdate({ state: "shipped" });
    resetPending();
  }, [onBulkUpdate, resetPending]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
      <BulkEditFieldsPopover
        pending={pending}
        setPending={setPending}
        resetKey={resetKey}
        pendingCount={pendingCount}
        hasPending={hasPending}
        onApply={handleApply}
        onReset={resetPending}
      />
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
