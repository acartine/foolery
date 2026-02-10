"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { Bead } from "@/lib/types";
import { BeadTypeBadge } from "@/components/bead-type-badge";
import { BeadStatusBadge } from "@/components/bead-status-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";

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

export const beadColumns: ColumnDef<Bead>[] = [
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.id.slice(0, 8)}
      </span>
    ),
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.title}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => <BeadTypeBadge type={row.original.type} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <BeadStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => <BeadPriorityBadge priority={row.original.priority} />,
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
