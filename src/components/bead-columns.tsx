"use client";

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
import { ChevronRight } from "lucide-react";

const BEAD_TYPES: BeadType[] = [
  "bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate",
];

const PRIORITIES: BeadPriority[] = [0, 1, 2, 3, 4];

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

export function getBeadColumns(opts: {
  showRepoColumn?: boolean;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
} | boolean = false): ColumnDef<Bead>[] {
  const showRepoColumn = typeof opts === "boolean" ? opts : (opts.showRepoColumn ?? false);
  const onUpdateBead = typeof opts === "boolean" ? undefined : opts.onUpdateBead;

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
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.id.replace(/^[^-]+-/, "")}
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => {
        const depth = (row.original as unknown as { _depth?: number })._depth ?? 0;
        return (
          <div className="flex items-start gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
            {depth > 0 && <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
            <span className="font-medium">{row.original.title}</span>
          </div>
        );
      },
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
      cell: ({ row }) => <BeadStatusBadge status={row.original.status} />,
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
    {
      accessorKey: "assignee",
      header: "Assignee",
      cell: ({ row }) => row.original.assignee ?? "-",
    },
    {
      accessorKey: "updated",
      header: "Updated",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {relativeTime(row.original.updated)}
        </span>
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
