"use client";

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { toast } from "sonner";
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

  const startEdit = useCallback((field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue("");
  }, []);

  const saveEdit = useCallback(async (field: string, value: string) => {
    if (!onUpdate) return;
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
    }
    setEditingField(null);
    setEditValue("");
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
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
            <CardTitle
              className={`text-xl ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1" : ""}`}
              onClick={() => onUpdate && startEdit("title", bead.title)}
            >
              {bead.title}
            </CardTitle>
          )}
          <code
            className="text-xs text-muted-foreground cursor-pointer hover:text-foreground"
            onClick={() => {
              const shortId = bead.id.replace(/^[^-]+-/, "");
              navigator.clipboard.writeText(shortId);
              toast.success(`Copied: ${shortId}`);
            }}
            title="Click to copy ID"
          >
            {bead.id}
          </code>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {onUpdate ? (
              <Select
                value={bead.type}
                onValueChange={(v) => onUpdate({ type: v as BeadType })}
              >
                <SelectTrigger className="h-7 w-auto border-none bg-transparent p-0 shadow-none">
                  <BeadTypeBadge type={bead.type} />
                </SelectTrigger>
                <SelectContent>
                  {BEAD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <BeadTypeBadge type={bead.type} />
            )}

            {onUpdate ? (
              <Select
                value={bead.status}
                onValueChange={(v) => onUpdate({ status: v as BeadStatus })}
              >
                <SelectTrigger className="h-7 w-auto border-none bg-transparent p-0 shadow-none">
                  <BeadStatusBadge status={bead.status} />
                </SelectTrigger>
                <SelectContent>
                  {BEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <BeadStatusBadge status={bead.status} />
            )}

            {onUpdate ? (
              <Select
                value={String(bead.priority)}
                onValueChange={(v) => onUpdate({ priority: Number(v) as BeadPriority })}
              >
                <SelectTrigger className="h-7 w-auto border-none bg-transparent p-0 shadow-none">
                  <BeadPriorityBadge priority={bead.priority} />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={String(p)}>P{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <BeadPriorityBadge priority={bead.priority} />
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Assignee</span>
              <p>{bead.assignee ?? "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Owner</span>
              <p>{bead.owner ?? "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p>{formatDate(bead.created)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Updated</span>
              <p>{formatDate(bead.updated)}</p>
            </div>
            {bead.due && (
              <div>
                <span className="text-muted-foreground">Due</span>
                <p>{formatDate(bead.due)}</p>
              </div>
            )}
            {bead.estimate != null && (
              <div>
                <span className="text-muted-foreground">Estimate</span>
                <p>{bead.estimate}h</p>
              </div>
            )}
          </div>

          {(bead.labels.length > 0 || onUpdate) && (
            <>
              <Separator />
              {editingField === "labels" ? (
                <Input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => saveEdit("labels", editValue)}
                  onKeyDown={(e) => handleKeyDown(e, "labels")}
                  placeholder="label1, label2, ..."
                />
              ) : (
                <div
                  className={`flex gap-1 flex-wrap ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 min-h-[28px]" : ""}`}
                  onClick={() => onUpdate && startEdit("labels", bead.labels.join(", "))}
                >
                  {bead.labels.length > 0 ? (
                    bead.labels.map((label) => (
                      <Badge key={label} variant="secondary">
                        {label}
                      </Badge>
                    ))
                  ) : onUpdate ? (
                    <span className="text-xs text-muted-foreground">Click to add labels</span>
                  ) : null}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
              className="min-h-[100px]"
            />
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 min-h-[40px]" : ""}`}
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
              className="min-h-[100px]"
            />
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 min-h-[40px]" : ""}`}
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
              className="min-h-[100px]"
            />
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${onUpdate ? "cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 min-h-[40px]" : ""}`}
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
