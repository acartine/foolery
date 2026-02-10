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
} from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { updateBead } from "@/lib/api";
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

  const columns = useMemo(
    () => getBeadColumns({
      showRepoColumn,
      onUpdateBead: (id, fields) => handleUpdateBead({ id, fields }),
    }),
    [showRepoColumn, handleUpdateBead]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : (
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
