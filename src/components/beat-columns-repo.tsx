"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { Beat } from "@/lib/types";

export function repoColumn(): ColumnDef<Beat> {
  return {
    id: "_repoName",
    header: "Repo",
    size: 100,
    minSize: 100,
    maxSize: 100,
    cell: ({ row }) => {
      const repoName = (
        row.original as unknown as
          Record<string, unknown>
      )._repoName;
      return repoName ? (
        <span
          className={
            "text-xs font-mono"
            + " text-muted-foreground"
          }
        >
          {repoName as string}
        </span>
      ) : (
        "-"
      );
    },
  };
}
