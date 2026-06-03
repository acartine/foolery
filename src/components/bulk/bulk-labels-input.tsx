"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { addLabel, type PendingSetter } from "./bulk-edit-shared";

type LabelMode = "add" | "remove";

function ChipList(
  { labels, onRemove }: { labels: string[]; onRemove: (label: string) => void },
) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="secondary" className="pr-1 gap-1">
          {label}
          <button
            type="button"
            className="rounded-full hover:bg-background/40"
            title={`Remove ${label}`}
            onClick={() => onRemove(label)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

function LabelChipSection(
  {
    mode,
    labels,
    onAdd,
    onRemoveChip,
  }: {
    mode: LabelMode;
    labels: string[];
    onAdd: (raw: string) => void;
    onRemoveChip: (label: string) => void;
  },
) {
  const [draft, setDraft] = useState("");
  const placeholder = mode === "add"
    ? "Add label, press Enter"
    : "Remove label, press Enter";

  const commit = useCallback(() => {
    onAdd(draft);
    setDraft("");
  }, [draft, onAdd]);

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        className="h-8"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <ChipList labels={labels} onRemove={onRemoveChip} />
    </div>
  );
}

/**
 * Chip editor for bulk label changes. Maintains two independent lists in
 * the shared pending-fields state: labels to add and labels to remove.
 * Empty / whitespace-only input is rejected and duplicates are deduped by
 * `addLabel` in bulk-edit-shared.
 */
export function BulkLabelsInput(
  {
    labels,
    removeLabels,
    setPending,
  }: {
    labels: string[];
    removeLabels: string[];
    setPending: PendingSetter;
  },
) {
  const addToList = useCallback(
    (key: "labels" | "removeLabels", raw: string) => {
      setPending((p) => {
        const next = addLabel(p[key] ?? [], raw);
        if (next === (p[key] ?? [])) return p;
        return { ...p, [key]: next };
      });
    },
    [setPending],
  );

  const removeFromList = useCallback(
    (key: "labels" | "removeLabels", label: string) => {
      setPending((p) => {
        const current = p[key] ?? [];
        const next = current.filter((l) => l !== label);
        return { ...p, [key]: next.length > 0 ? next : undefined };
      });
    },
    [setPending],
  );

  return (
    <div className="flex flex-col gap-2">
      <LabelChipSection
        mode="add"
        labels={labels}
        onAdd={(raw) => addToList("labels", raw)}
        onRemoveChip={(label) => removeFromList("labels", label)}
      />
      <LabelChipSection
        mode="remove"
        labels={removeLabels}
        onAdd={(raw) => addToList("removeLabels", raw)}
        onRemoveChip={(label) => removeFromList("removeLabels", label)}
      />
    </div>
  );
}
