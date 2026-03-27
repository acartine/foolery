"use client";

import { useState, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { X, Clapperboard } from "lucide-react";
import type { Beat, BeatPriority, MemoryWorkflowDescriptor } from "@/lib/types";
import { isWaveLabel, isReadOnlyLabel } from "@/lib/wave-slugs";
import type { UpdateBeatInput } from "@/lib/schemas";
import { BeatPriorityBadge } from "@/components/beat-priority-badge";
import { StateDropdown } from "./beat-detail-state-dropdown";

const PRIORITIES: BeatPriority[] = [0, 1, 2, 3, 4];

/** @internal Exported for testing only. */
export function validNextStates(
  currentState: string | undefined,
  workflow: MemoryWorkflowDescriptor,
  rawKnoState?: string,
): string[] {
  if (!currentState) return [];
  const normalizeForTransitions = (state: string | undefined): string | undefined => {
    const normalizedState = state?.trim().toLowerCase();
    if (!normalizedState) return undefined;
    if (normalizedState === "impl" && (workflow.states ?? []).includes("implementation")) {
      return "implementation";
    }
    return normalizedState;
  };

  const normalized = normalizeForTransitions(currentState);
  if (!normalized) return [];
  const isQueuedDisplayState = normalized.startsWith("ready_for_");
  const normalizedRawKnoState = normalizeForTransitions(rawKnoState);

  // If the raw kno state differs from the display state, the knot is stuck in an
  // active phase that was rolled back for display. Compute transitions from the
  // actual kno state and include all workflow states as escape hatches.
  const isRolledBack = Boolean(
    normalizedRawKnoState && normalizedRawKnoState !== normalized,
  );
  const effectiveState = isRolledBack && normalizedRawKnoState
    ? normalizedRawKnoState
    : normalized;

  const next = new Set<string>();
  for (const t of workflow.transitions ?? []) {
    if (t.from === effectiveState || t.from === "*") {
      next.add(t.to);
    }
  }

  // Allow rollback from active/review states to any earlier queue state.
  const statesList = workflow.states ?? [];
  const effectiveIndex = statesList.indexOf(effectiveState);
  if (effectiveIndex > 0) {
    for (let i = 0; i < effectiveIndex; i++) {
      const earlier = statesList[i];
      if (earlier && earlier.startsWith("ready_for_")) {
        next.add(earlier);
      }
    }
  }

  // When stuck (rolled back), also add all non-terminal workflow states as force targets
  if (isRolledBack) {
    for (const state of workflow.states ?? []) {
      if (!workflow.terminalStates?.includes(state)) {
        next.add(state);
      }
    }
  }

  // Remove current display state and raw state from options
  next.delete(normalized);
  if (normalizedRawKnoState) next.delete(normalizedRawKnoState);

  // Keep queue-to-queue transitions hidden for queued rows, but allow queue
  // targets from active rows so users can advance/rollback action states.
  if (isRolledBack || !isQueuedDisplayState) {
    return Array.from(next);
  }
  return Array.from(next).filter((s) => !s.startsWith("ready_for_"));
}

/** @internal Exported for sub-component use. */
export function formatStateName(state: string): string {
  return state.replace(/_/g, " ");
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface BeatDetailProps {
  beat: Beat;
  onUpdate?: (fields: UpdateBeatInput) => Promise<void>;
  workflow?: MemoryWorkflowDescriptor | null;
}

interface EditableSectionProps {
  field: "description" | "notes" | "acceptance";
  title: string;
  value: string;
  placeholder: string;
  editingField: string | null;
  editValue: string;
  onStartEdit: (field: string, currentValue: string) => void;
  onCancelEdit: () => void;
  onChangeEditValue: (value: string) => void;
  onSaveEdit: (field: string, value: string) => Promise<void>;
  onUpdate?: (fields: UpdateBeatInput) => Promise<void>;
}

function EditableSection({
  field,
  title,
  value,
  placeholder,
  editingField,
  editValue,
  onStartEdit,
  onCancelEdit,
  onChangeEditValue,
  onSaveEdit,
  onUpdate,
}: EditableSectionProps) {
  const isEditing = editingField === field;

  return (
    <section className="min-w-0 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {isEditing ? (
        <Textarea
          autoFocus
          value={editValue}
          onChange={(e) => onChangeEditValue(e.target.value)}
          onBlur={() => {
            void onSaveEdit(field, editValue);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancelEdit();
          }}
          className="min-h-[88px] max-h-[40vh] overflow-y-auto px-2 py-1.5 text-sm [field-sizing:fixed]"
        />
      ) : (
        <p
          className={`min-h-[20px] max-w-full whitespace-pre-wrap break-words text-sm leading-snug ${onUpdate ? "cursor-pointer rounded px-1 py-0.5 hover:bg-muted/70" : ""}`}
          onClick={() => onUpdate && onStartEdit(field, value)}
        >
          {value || (onUpdate ? placeholder : "-")}
        </p>
      )}
    </section>
  );
}

export function BeatDetail({ beat, onUpdate, workflow }: BeatDetailProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const savingRef = useRef(false);

  const startEdit = useCallback((field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue("");
  }, []);

  const saveEdit = useCallback(async (field: string, value: string) => {
    if (!onUpdate || savingRef.current) return;
    savingRef.current = true;
    const fields: UpdateBeatInput = {};
    if (field === "title") fields.title = value;
    else if (field === "description") fields.description = value;
    else if (field === "acceptance") fields.acceptance = value;
    else if (field === "notes") fields.notes = value;
    else if (field === "labels") {
      fields.labels = value.split(",").map((s) => s.trim()).filter(Boolean);
    }
    try {
      await onUpdate(fields);
    } catch {
      // Error toast shown by mutation onError handler
    } finally {
      savingRef.current = false;
      setEditingField(null);
      setEditValue("");
    }
  }, [onUpdate]);

  const fireUpdate = useCallback((fields: UpdateBeatInput) => {
    if (!onUpdate) return;
    onUpdate(fields).catch(() => {
      // Error toast shown by mutation onError handler
    });
  }, [onUpdate]);

  const removeLabel = useCallback((label: string) => {
    if (!onUpdate) return;
    onUpdate({ removeLabels: [label] }).catch(() => {});
  }, [onUpdate]);

  return (
    <div className="space-y-2">
      <BeatDetailHeader
        beat={beat}
        onUpdate={onUpdate}
        workflow={workflow}
        fireUpdate={fireUpdate}
        removeLabel={removeLabel}
      />

      <EditableSection
        field="description"
        title="Description"
        value={beat.description ?? ""}
        placeholder="Click to add description"
        editingField={editingField}
        editValue={editValue}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onChangeEditValue={setEditValue}
        onSaveEdit={saveEdit}
        onUpdate={onUpdate}
      />

      <EditableSection
        field="notes"
        title="Notes"
        value={beat.notes ?? ""}
        placeholder="Click to add notes"
        editingField={editingField}
        editValue={editValue}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onChangeEditValue={setEditValue}
        onSaveEdit={saveEdit}
        onUpdate={onUpdate}
      />

      <EditableSection
        field="acceptance"
        title="Acceptance"
        value={beat.acceptance ?? ""}
        placeholder="Click to add acceptance criteria"
        editingField={editingField}
        editValue={editValue}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onChangeEditValue={setEditValue}
        onSaveEdit={saveEdit}
        onUpdate={onUpdate}
      />
    </div>
  );
}

// ── Header sub-component (extracted to keep BeatDetail under 75 lines) ──

interface BeatDetailHeaderProps {
  beat: Beat;
  onUpdate?: (fields: UpdateBeatInput) => Promise<void>;
  workflow?: MemoryWorkflowDescriptor | null;
  fireUpdate: (fields: UpdateBeatInput) => void;
  removeLabel: (label: string) => void;
}

function BeatDetailHeader({
  beat,
  onUpdate,
  workflow,
  fireUpdate,
  removeLabel,
}: BeatDetailHeaderProps) {
  return (
    <section className="space-y-1.5 border-b border-border/70 pb-2">
      <div className="flex flex-wrap gap-1.5">
        <StateDropdown
          beat={beat}
          onUpdate={onUpdate}
          workflow={workflow}
          fireUpdate={fireUpdate}
        />

        {onUpdate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title="Change beat priority" className="cursor-pointer">
                <BeatPriorityBadge priority={beat.priority} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={String(beat.priority)}
                onValueChange={(v) =>
                  fireUpdate({
                    priority: Number(v) as BeatPriority,
                  })
                }
              >
                {PRIORITIES.map((p) => (
                  <DropdownMenuRadioItem key={p} value={String(p)}>P{p}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <BeatPriorityBadge priority={beat.priority} />
        )}
      </div>

      <BeatDetailMetadata beat={beat} />

      <BeatDetailLabels beat={beat} onUpdate={onUpdate} removeLabel={removeLabel} />
    </section>
  );
}

// ── Metadata sub-component ──

function BeatDetailMetadata({ beat }: { beat: Beat }) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {beat.profileId && (
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
            Profile: {beat.profileId}
          </Badge>
        )}
        {beat.nextActionOwnerKind && beat.nextActionOwnerKind !== "none" && (
          <Badge
            variant="secondary"
            className={
              beat.nextActionOwnerKind === "human"
                ? "bg-amber-100 text-amber-700"
                : "bg-blue-100 text-blue-700"
            }
          >
            Owner type: {beat.nextActionOwnerKind === "human" ? "Human" : "Agent"}
          </Badge>
        )}
        {beat.requiresHumanAction && (
          <Badge variant="secondary" className="bg-rose-100 text-rose-700">
            Human action required
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{beat.owner ?? "someone"} created {formatDate(beat.created)}</span>
        <span>updated {formatDate(beat.updated)}</span>
      </div>
    </>
  );
}

// ── Labels sub-component ──

interface BeatDetailLabelsProps {
  beat: Beat;
  onUpdate?: (fields: UpdateBeatInput) => Promise<void>;
  removeLabel: (label: string) => void;
}

function BeatDetailLabels({ beat, onUpdate, removeLabel }: BeatDetailLabelsProps) {
  if (beat.labels.length === 0) return null;

  const isOrchestrated = beat.labels.some(isWaveLabel);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {isOrchestrated && (
        <Badge variant="secondary" className="gap-1 bg-slate-100 text-slate-600">
          <Clapperboard className="size-2.5" />
          Orchestrated
        </Badge>
      )}
      {beat.labels.map((label) => (
        <Badge key={label} variant="secondary" className="gap-1 pr-1">
          {label}
          {onUpdate && !isReadOnlyLabel(label) && (
            <button
              type="button"
              title="Remove label"
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
              onClick={() => removeLabel(label)}
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
    </div>
  );
}
