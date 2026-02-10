"use client";

import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Bead, BeadType, BeadPriority } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { BeadTypeBadge } from "@/components/bead-type-badge";
import { BeadStatusBadge } from "@/components/bead-status-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ThumbsDown } from "lucide-react";

const BEAD_TYPES: BeadType[] = [
  "bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate",
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

  const labelsWithout = (bead.labels ?? []).filter((l) => l !== "stage:verification");

  return (
    <>
      {onCloseBead && (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded p-1 text-green-700 hover:bg-green-100"
          title="Verify (LGTM)"
          onClick={(e) => {
            e.stopPropagation();
            onCloseBead(bead.id);
            onUpdateBead?.(bead.id, { labels: labelsWithout });
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

  const labelsWithout = (bead.labels ?? []).filter((l) => l !== "stage:verification");

  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded p-1 text-red-700 hover:bg-red-100"
      title="Reject"
      onClick={(e) => {
        e.stopPropagation();
        onUpdateBead(bead.id, { status: "open", labels: labelsWithout });
      }}
    >
      <ThumbsDown className="size-4" />
    </button>
  );
}

function TitleCell({ bead }: { bead: Bead }) {
  const labels = bead.labels ?? [];
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{bead.title}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-muted-foreground text-xs">
          {relativeTime(bead.updated)}
        </span>
        {labels.map((label) => (
          <span
            key={label}
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${labelColor(label)}`}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function getBeadColumns(opts: BeadColumnOpts | boolean = false): ColumnDef<Bead>[] {
  const showRepoColumn = typeof opts === "boolean" ? opts : (opts.showRepoColumn ?? false);
  const onUpdateBead = typeof opts === "boolean" ? undefined : opts.onUpdateBead;
  const onCloseBead = typeof opts === "boolean" ? undefined : opts.onCloseBead;

  const columns: ColumnDef<Bead>[] = [
    {
      id: "select",
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
      header: "ID",
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
      cell: ({ row }) => <TitleCell bead={row.original} />,
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        if (!onUpdateBead) return <BeadTypeBadge type={row.original.type} />;
        return (
          <Select
            value={row.original.type}
            onValueChange={(v) => {
              onUpdateBead(row.original.id, { type: v as BeadType });
            }}
          >
            <SelectTrigger
              className="h-7 w-auto border-none bg-transparent p-0 shadow-none"
              onClick={(e) => e.stopPropagation()}
            >
              <BeadTypeBadge type={row.original.type} />
            </SelectTrigger>
            <SelectContent>
              {BEAD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <VerificationButtons
            bead={row.original}
            onUpdateBead={onUpdateBead}
            onCloseBead={onCloseBead}
          />
          <BeadStatusBadge status={row.original.status} />
          <RejectButton bead={row.original} onUpdateBead={onUpdateBead} />
        </div>
      ),
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => {
        if (!onUpdateBead) return <BeadPriorityBadge priority={row.original.priority} />;
        return (
          <Select
            value={String(row.original.priority)}
            onValueChange={(v) => {
              onUpdateBead(row.original.id, { priority: Number(v) as BeadPriority });
            }}
          >
            <SelectTrigger
              className="h-7 w-auto border-none bg-transparent p-0 shadow-none"
              onClick={(e) => e.stopPropagation()}
            >
              <BeadPriorityBadge priority={row.original.priority} />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={String(p)}>
                  P{p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
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
