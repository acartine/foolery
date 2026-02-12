"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Bead, BeadType, BeadStatus, BeadPriority } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { BeadTypeBadge } from "@/components/bead-type-badge";
import { BeadStatusBadge } from "@/components/bead-status-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ThumbsDown, ChevronRight, X } from "lucide-react";

const BEAD_TYPES: BeadType[] = [
  "bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate",
];

const BEAD_STATUSES: BeadStatus[] = [
  "open", "in_progress", "blocked", "deferred", "closed",
];

const PRIORITIES: BeadPriority[] = [0, 1, 2, 3, 4];

const LABEL_COLORS = [
  "bg-red-100 text-red-800",
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-yellow-100 text-yellow-800",
  "bg-purple-100 text-purple-800",
  "bg-pink-100 text-pink-800",
  "bg-indigo-100 text-indigo-800",
  "bg-orange-100 text-orange-800",
  "bg-teal-100 text-teal-800",
  "bg-cyan-100 text-cyan-800",
];

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export interface BeadColumnOpts {
  showRepoColumn?: boolean;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
  onCloseBead?: (id: string) => void;
  onTitleClick?: (bead: Bead) => void;
}

function VerificationButtons({
  bead,
  onUpdateBead,
  onCloseBead,
}: {
  bead: Bead;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
  onCloseBead?: (id: string) => void;
}) {
  const hasVerification = bead.labels?.includes("stage:verification");
  if (!hasVerification || (!onUpdateBead && !onCloseBead)) return null;

  return (
    <>
      {onCloseBead && (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded p-1 text-green-700 hover:bg-green-100"
          title="Verify (LGTM)"
          onClick={(e) => {
            e.stopPropagation();
            onUpdateBead?.(bead.id, { removeLabels: ["stage:verification"] });
            onCloseBead(bead.id);
          }}
        >
          <Check className="size-4" />
        </button>
      )}
    </>
  );
}

function RejectButton({
  bead,
  onUpdateBead,
}: {
  bead: Bead;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
}) {
  const hasVerification = bead.labels?.includes("stage:verification");
  if (!hasVerification || !onUpdateBead) return null;

  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded p-1 text-red-700 hover:bg-red-100"
      title="Reject"
      onClick={(e) => {
        e.stopPropagation();
        onUpdateBead(bead.id, { status: "open", removeLabels: ["stage:verification"] });
      }}
    >
      <ThumbsDown className="size-4" />
    </button>
  );
}

function AddLabelDropdown({
  beadId,
  existingLabels,
  onUpdateBead,
}: {
  beadId: string;
  existingLabels: string[];
  onUpdateBead: (id: string, fields: UpdateBeadInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const knownLabels = [
    "bug", "feature", "frontend", "backend", "urgent", "blocked",
    "stage:verification", "needs-review", "wontfix", "duplicate",
  ];

  const availableLabels = knownLabels.filter((l) => !existingLabels.includes(l));

  const addLabel = (label: string) => {
    const currentLabels = [...existingLabels, label];
    onUpdateBead(beadId, { labels: currentLabels });
    setOpen(false);
    setNewLabel("");
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-add-label
          className="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold leading-none bg-green-700 text-white hover:bg-green-600"
          onClick={(e) => e.stopPropagation()}
        >
          + Label
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <div className="p-1">
          <input
            type="text"
            placeholder="New label..."
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLabel.trim()) {
                e.preventDefault();
                addLabel(newLabel.trim());
              }
              e.stopPropagation();
            }}
            className="w-full px-2 py-1 text-xs border rounded mb-1 outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>
        {availableLabels.map((label) => (
          <DropdownMenuItem key={label} onClick={() => addLabel(label)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TitleCell({ bead, onTitleClick, onUpdateBead }: {
  bead: Bead;
  onTitleClick?: (bead: Bead) => void;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
}) {
  const labels = bead.labels ?? [];
  return (
    <div className="flex flex-col gap-0.5">
      {onTitleClick ? (
        <button
          type="button"
          className="font-medium text-left hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onTitleClick(bead);
          }}
        >
          {bead.title}
        </button>
      ) : (
        <span className="font-medium">{bead.title}</span>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-muted-foreground text-xs">
          {relativeTime(bead.updated)}
        </span>
        {labels.map((label) => (
          <span
            key={label}
            className={`inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium leading-none ${labelColor(label)}`}
          >
            {label}
            {onUpdateBead && (
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-black/10 p-0 leading-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateBead(bead.id, { removeLabels: [label] });
                }}
              >
                <X className="size-2.5" />
              </button>
            )}
          </span>
        ))}
        {onUpdateBead && (
          <AddLabelDropdown beadId={bead.id} existingLabels={labels} onUpdateBead={onUpdateBead} />
        )}
      </div>
    </div>
  );
}

export function getBeadColumns(opts: BeadColumnOpts | boolean = false): ColumnDef<Bead>[] {
  const showRepoColumn = typeof opts === "boolean" ? opts : (opts.showRepoColumn ?? false);
  const onUpdateBead = typeof opts === "boolean" ? undefined : opts.onUpdateBead;
  const onCloseBead = typeof opts === "boolean" ? undefined : opts.onCloseBead;
  const onTitleClick = typeof opts === "boolean" ? undefined : opts.onTitleClick;

  const columns: ColumnDef<Bead>[] = [
    {
      id: "select",
      size: 30,
      minSize: 30,
      maxSize: 30,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
    },
    {
      accessorKey: "id",
      header: "",
      size: 60,
      minSize: 60,
      maxSize: 60,
      enableSorting: false,
      cell: ({ row }) => {
        const shortId = row.original.id.replace(/^[^-]+-/, "");
        return (
          <span
            className="font-mono text-xs text-muted-foreground cursor-pointer hover:text-foreground"
            title="Click to copy ID"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(shortId);
              toast.success(`Copied: ${shortId}`);
            }}
          >
            {shortId}
          </span>
        );
      },
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => {
        const depth = (row.original as unknown as { _depth?: number })._depth ?? 0;
        return (
          <div className="flex items-start gap-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
            {depth > 0 && <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
            <TitleCell bead={row.original} onTitleClick={onTitleClick} onUpdateBead={onUpdateBead} />
          </div>
        );
      },
    },
    {
      accessorKey: "priority",
      header: "Priority",
      size: 70,
      minSize: 70,
      maxSize: 70,
      cell: ({ row }) => {
        if (!onUpdateBead) return <BeadPriorityBadge priority={row.original.priority} />;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                <BeadPriorityBadge priority={row.original.priority} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={String(row.original.priority)} onValueChange={(v) => onUpdateBead(row.original.id, { priority: Number(v) as BeadPriority })}>
                {PRIORITIES.map((p) => (
                  <DropdownMenuRadioItem key={p} value={String(p)}>P{p}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      size: 80,
      minSize: 80,
      maxSize: 80,
      cell: ({ row }) => {
        if (!onUpdateBead) return <BeadTypeBadge type={row.original.type} />;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                <BeadTypeBadge type={row.original.type} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={row.original.type} onValueChange={(v) => onUpdateBead(row.original.id, { type: v as BeadType })}>
                {BEAD_TYPES.map((t) => (
                  <DropdownMenuRadioItem key={t} value={t}>{t}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 130,
      minSize: 130,
      maxSize: 130,
      cell: ({ row }) => (
        <div className="flex items-center gap-0.5">
          <VerificationButtons
            bead={row.original}
            onUpdateBead={onUpdateBead}
            onCloseBead={onCloseBead}
          />
          {onUpdateBead ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <BeadStatusBadge status={row.original.status} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={row.original.status} onValueChange={(v) => onUpdateBead(row.original.id, { status: v as BeadStatus })}>
                  {BEAD_STATUSES.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>{s.replace("_", " ")}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <BeadStatusBadge status={row.original.status} />
          )}
          <RejectButton bead={row.original} onUpdateBead={onUpdateBead} />
        </div>
      ),
    },
  ];

  if (showRepoColumn) {
    columns.splice(1, 0, {
      id: "_repoName",
      header: "Repo",
      cell: ({ row }) => {
        const repoName = (row.original as unknown as Record<string, unknown>)._repoName;
        return repoName ? (
          <span className="text-xs font-mono text-muted-foreground">
            {repoName as string}
          </span>
        ) : (
          "-"
        );
      },
    });
  }

  return columns;
}

export const beadColumns = getBeadColumns({ showRepoColumn: false });
