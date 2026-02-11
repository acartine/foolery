"use client";

import { useState, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { Bead, BeadType, BeadStatus, BeadPriority } from "@/lib/types";
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

  /** Fire-and-forget update for Select dropdowns - does not return a Promise */
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: string) => {
    if (e.key === "Escape") {
      cancelEdit();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit(field, editValue);
    }
  }, [cancelEdit, saveEdit, editValue]);

  return (
    <div className="space-y-1">
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <code
            className="text-xs text-muted-foreground cursor-pointer hover:text-foreground mt-1.5"
            onClick={() => {
              const shortId = bead.id.replace(/^[^-]+-/, "");
              navigator.clipboard.writeText(shortId);
              toast.success(`Copied: ${shortId}`);
            }}
            title="Click to copy ID"
          >
            {bead.id.replace(/^[^-]+-/, "")}
          </code>
          {editingField === "title" ? (
            <Input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit("title", editValue)}
              onKeyDown={(e) => handleKeyDown(e, "title")}
              className="text-xl font-semibold"
            />
          ) : (
            <h2
              className={`text-xl font-semibold ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded px-1" : ""}`}
              onClick={() => onUpdate && startEdit("title", bead.title)}
            >
              {bead.title}
            </h2>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {onUpdate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="cursor-pointer">
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
                <button type="button" className="cursor-pointer">
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
                <button type="button" className="cursor-pointer">
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

        <p className="text-sm text-muted-foreground">
          {bead.owner ?? "someone"} created this on {formatDate(bead.created)}
        </p>
        <p className="text-sm text-muted-foreground">
          last update {formatDate(bead.updated)}
        </p>

        {bead.labels.length > 0 && (
          <div className="flex gap-1 flex-wrap items-center">
            {bead.labels.map((label) => (
              <Badge key={label} variant="secondary" className="gap-1 pr-1">
                {label}
                {onUpdate && (
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                    onClick={() => removeLabel(label)}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Description</CardTitle>
        </CardHeader>
        <CardContent>
          {editingField === "description" ? (
            <Textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit("description", editValue)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
              }}
              className="min-h-[60px]"
            />
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded min-h-[24px]" : ""}`}
              onClick={() => onUpdate && startEdit("description", bead.description ?? "")}
            >
              {bead.description || (onUpdate ? "Click to add description" : "-")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {editingField === "notes" ? (
            <Textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit("notes", editValue)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
              }}
              className="min-h-[60px]"
            />
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded min-h-[24px]" : ""}`}
              onClick={() => onUpdate && startEdit("notes", bead.notes ?? "")}
            >
              {bead.notes || (onUpdate ? "Click to add notes" : "-")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Acceptance Criteria</CardTitle>
        </CardHeader>
        <CardContent>
          {editingField === "acceptance" ? (
            <Textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit("acceptance", editValue)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
              }}
              className="min-h-[60px]"
            />
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded min-h-[24px]" : ""}`}
              onClick={() => onUpdate && startEdit("acceptance", bead.acceptance ?? "")}
            >
              {bead.acceptance || (onUpdate ? "Click to add acceptance criteria" : "-")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
