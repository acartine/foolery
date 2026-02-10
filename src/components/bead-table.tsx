"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Bead, BeadType, BeadStatus, BeadPriority } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { updateBead } from "@/lib/api";
import { buildHierarchy } from "@/lib/bead-hierarchy";
import { getBeadColumns } from "@/components/bead-columns";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

export function BeadTable({
  data,
  showRepoColumn = false,
}: {
  data: Bead[];
  showRepoColumn?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const { mutate: handleUpdateBead } = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: UpdateBeadInput }) => {
      const repoPath = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = repoPath?._repoPath as string | undefined;
      return updateBead(id, fields, repo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
    },
    onError: () => {
      toast.error("Failed to update bead");
    },
  });

  const hierarchicalData = useMemo(() => buildHierarchy(data), [data]);

  const columns = useMemo(
    () => getBeadColumns({
      showRepoColumn,
      onUpdateBead: (id, fields) => handleUpdateBead({ id, fields }),
    }),
    [showRepoColumn, handleUpdateBead]
  );

  const { mutate: bulkUpdate } = useMutation({
    mutationFn: async ({ ids, fields }: { ids: string[]; fields: UpdateBeadInput }) => {
      await Promise.all(
        ids.map((id) => {
          const bead = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
          const repo = bead?._repoPath as string | undefined;
          return updateBead(id, fields, repo);
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      setRowSelection({});
      toast.success("Beads updated");
    },
    onError: () => {
      toast.error("Failed to update beads");
    },
  });

  const table = useReactTable({
    data: hierarchicalData,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectedIds = table.getFilteredSelectedRowModel().rows.map((r) => r.original.id);

  return (
    <div className="space-y-4">
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-4 rounded-md border bg-muted/50 p-2">
          <span className="text-sm font-medium">
            {selectedIds.length} selected
          </span>
          <Select
            onValueChange={(v) => bulkUpdate({ ids: selectedIds, fields: { type: v as BeadType } })}
          >
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue placeholder="Set type..." />
            </SelectTrigger>
            <SelectContent>
              {(["bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate"] as const).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(v) => bulkUpdate({ ids: selectedIds, fields: { priority: Number(v) as BeadPriority } })}
          >
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue placeholder="Set priority..." />
            </SelectTrigger>
            <SelectContent>
              {([0, 1, 2, 3, 4] as const).map((p) => (
                <SelectItem key={p} value={String(p)}>P{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(v) => bulkUpdate({ ids: selectedIds, fields: { status: v as BeadStatus } })}
          >
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue placeholder="Set status..." />
            </SelectTrigger>
            <SelectContent>
              {(["open", "in_progress", "blocked", "deferred", "closed"] as const).map((s) => (
                <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="flex items-center gap-1"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                      <ArrowUpDown className="size-3" />
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => {
                  const repoPath = (
                    row.original as unknown as Record<string, unknown>
                  )._repoPath as string | undefined;
                  const qs = repoPath
                    ? `?repo=${encodeURIComponent(repoPath)}`
                    : "";
                  router.push(`/beads/${row.original.id}${qs}`);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center"
              >
                No beads found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
