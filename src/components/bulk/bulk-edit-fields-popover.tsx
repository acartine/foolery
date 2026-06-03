"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { SlidersHorizontal, Check, RotateCcw } from "lucide-react";
import { builtinWorkflowDescriptors } from "@/lib/workflows";
import type { BeatPriority } from "@/lib/types";
import { BulkLabelsInput } from "./bulk-labels-input";
import {
  formatLabel,
  commonTypes,
  BULK_SET_STATE_OPTIONS,
  MULTISELECT_BUTTON_CLASS,
  MULTISELECT_PRIMARY_CLASS,
  type PendingBulkFields,
  type PendingSetter,
} from "./bulk-edit-shared";

interface BulkEditFieldsPopoverProps {
  pending: PendingBulkFields;
  setPending: PendingSetter;
  resetKey: number;
  pendingCount: number;
  hasPending: boolean;
  onApply: () => void;
  onReset: () => void;
}

function FieldRow(
  { label, children }: { label: string; children: React.ReactNode },
) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FieldSelects(
  { setPending, resetKey }: {
    setPending: PendingSetter;
    resetKey: number;
  },
) {
  return (
    <>
      <FieldRow label="Type">
        <Select
          key={`type-${resetKey}`}
          onValueChange={(v) => setPending((p) => ({ ...p, type: v }))}
        >
          <SelectTrigger className="w-[150px] h-8">
            <SelectValue placeholder="Set type..." />
          </SelectTrigger>
          <SelectContent>
            {commonTypes.map((t) => (
              <SelectItem key={t} value={t}>{formatLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Priority">
        <Select
          key={`priority-${resetKey}`}
          onValueChange={(v) =>
            setPending((p) => ({ ...p, priority: Number(v) as BeatPriority }))}
        >
          <SelectTrigger className="w-[150px] h-8">
            <SelectValue placeholder="Set priority..." />
          </SelectTrigger>
          <SelectContent>
            {([0, 1, 2, 3, 4] as const).map((p) => (
              <SelectItem key={p} value={String(p)}>P{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Profile">
        <Select
          key={`profile-${resetKey}`}
          onValueChange={(v) => setPending((p) => ({ ...p, profileId: v }))}
        >
          <SelectTrigger className="w-[150px] h-8">
            <SelectValue placeholder="Set profile..." />
          </SelectTrigger>
          <SelectContent>
            {builtinWorkflowDescriptors().map((p) => (
              <SelectItem key={p.id} value={p.id}>{formatLabel(p.id)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="State">
        <Select
          key={`state-${resetKey}`}
          onValueChange={(v) => setPending((p) => ({ ...p, state: v }))}
        >
          <SelectTrigger className="w-[150px] h-8">
            <SelectValue placeholder="Set state..." />
          </SelectTrigger>
          <SelectContent>
            {BULK_SET_STATE_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
    </>
  );
}

/**
 * Single grouped surface for all per-field bulk editors (Type, Priority,
 * Profile, State, and add/remove Labels). Replaces the four always-visible
 * inline Selects so the multi-select bar stays compact and never needs
 * horizontal scrolling to reach the primary actions.
 */
export function BulkEditFieldsPopover(
  {
    pending,
    setPending,
    resetKey,
    pendingCount,
    hasPending,
    onApply,
    onReset,
  }: BulkEditFieldsPopoverProps,
) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="lg"
          className={MULTISELECT_PRIMARY_CLASS}
          title="Edit fields on selected beats"
        >
          <SlidersHorizontal className="size-4" />Edit fields
          {pendingCount > 0 && (
            <Badge variant="default" className="ml-0.5 h-4 px-1">
              {pendingCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 flex flex-col gap-3">
        <FieldSelects setPending={setPending} resetKey={resetKey} />
        <div className="border-t pt-2 flex flex-col gap-2">
          <span className="text-sm font-medium">Labels</span>
          <BulkLabelsInput
            labels={pending.labels ?? []}
            removeLabels={pending.removeLabels ?? []}
            setPending={setPending}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t pt-2">
          <Button
            variant="ghost"
            size="sm"
            className={MULTISELECT_BUTTON_CLASS}
            disabled={!hasPending}
            title="Reset pending field changes"
            onClick={onReset}
          >
            <RotateCcw className="size-4" />Reset
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={MULTISELECT_PRIMARY_CLASS}
            disabled={!hasPending}
            title="Apply changes to selected beats"
            onClick={onApply}
          >
            <Check className="size-4" />Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
