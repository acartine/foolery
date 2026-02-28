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
import type { Bead, BeadType, BeadStatus, BeadPriority } from "@/lib/types";
import { isWaveLabel, isReadOnlyLabel } from "@/lib/wave-slugs";
import type { UpdateBeadInput } from "@/lib/schemas";
import { BeadStatusBadge } from "@/components/bead-status-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
import { BeadTypeBadge } from "@/components/bead-type-badge";

const BEAD_TYPES: BeadType[] = [
  "bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate",
];

const BEAD_STATUSES: BeadStatus[] = [
  "open", "in_progress", "blocked", "deferred", "closed",
];

const PRIORITIES: BeadPriority[] = [0, 1, 2, 3, 4];

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface BeadDetailProps {
  bead: Bead;
  onUpdate?: (fields: UpdateBeadInput) => Promise<void>;
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
  onUpdate?: (fields: UpdateBeadInput) => Promise<void>;
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

export function BeadDetail({ bead, onUpdate }: BeadDetailProps) {
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
    const fields: UpdateBeadInput = {};
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

  const fireUpdate = useCallback((fields: UpdateBeadInput) => {
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
      <section className="space-y-1.5 border-b border-border/70 pb-2">
        <div className="flex flex-wrap gap-1.5">
          {onUpdate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title="Change beat type" className="cursor-pointer">
                  <BeadTypeBadge type={bead.type} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={bead.type} onValueChange={(v) => fireUpdate({ type: v as BeadType })}>
                  {BEAD_TYPES.map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>{t}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <BeadTypeBadge type={bead.type} />
          )}

          {onUpdate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title="Change beat status" className="cursor-pointer">
                  <BeadStatusBadge status={bead.status} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={bead.status} onValueChange={(v) => fireUpdate({ status: v as BeadStatus })}>
                  {BEAD_STATUSES.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>{s.replace("_", " ")}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <BeadStatusBadge status={bead.status} />
          )}

          {onUpdate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title="Change beat priority" className="cursor-pointer">
                  <BeadPriorityBadge priority={bead.priority} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={String(bead.priority)} onValueChange={(v) => fireUpdate({ priority: Number(v) as BeadPriority })}>
                  {PRIORITIES.map((p) => (
                    <DropdownMenuRadioItem key={p} value={String(p)}>P{p}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <BeadPriorityBadge priority={bead.priority} />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {bead.profileId && (
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
              Profile: {bead.profileId}
            </Badge>
          )}
          {bead.nextActionOwnerKind && bead.nextActionOwnerKind !== "none" && (
            <Badge
              variant="secondary"
              className={
                bead.nextActionOwnerKind === "human"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-blue-100 text-blue-700"
              }
            >
              Next owner: {bead.nextActionOwnerKind}
            </Badge>
          )}
          {bead.requiresHumanAction && (
            <Badge variant="secondary" className="bg-rose-100 text-rose-700">
              Human action required
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{bead.owner ?? "someone"} created {formatDate(bead.created)}</span>
          <span>updated {formatDate(bead.updated)}</span>
        </div>

        {bead.labels.length > 0 && (() => {
          const isOrchestrated = bead.labels.some(isWaveLabel);
          return (
            <div className="flex flex-wrap items-center gap-1">
              {isOrchestrated && (
                <Badge variant="secondary" className="gap-1 bg-slate-100 text-slate-600">
                  <Clapperboard className="size-2.5" />
                  Orchestrated
                </Badge>
              )}
              {bead.labels.map((label) => (
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
        })()}
      </section>

      <EditableSection
        field="description"
        title="Description"
        value={bead.description ?? ""}
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
        value={bead.notes ?? ""}
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
        value={bead.acceptance ?? ""}
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
