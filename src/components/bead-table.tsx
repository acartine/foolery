"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { updateBead, closeBead } from "@/lib/api";
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

const PAGE_SIZE_KEY = "foolery-page-size";
const DEFAULT_PAGE_SIZE = 50;

function getStoredPageSize(): number {
  if (typeof window === "undefined") return DEFAULT_PAGE_SIZE;
  const stored = localStorage.getItem(PAGE_SIZE_KEY);
  if (!stored) return DEFAULT_PAGE_SIZE;
  const parsed = Number(stored);
  return [25, 50, 100].includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

export function BeadTable({
  data,
  showRepoColumn = false,
  onSelectionChange,
  selectionVersion,
  onRowFocus,
}: {
  data: Bead[];
  showRepoColumn?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  selectionVersion?: number;
  onRowFocus?: (bead: Bead | null) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [userSorted, setUserSorted] = useState(false);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  const { mutate: handleUpdateBead } = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: UpdateBeadInput }) => {
      const repoPath = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = repoPath?._repoPath as string | undefined;
      return updateBead(id, fields, repo);
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      queryClient.invalidateQueries({ queryKey: ["bead", id] });
    },
    onError: () => {
      toast.error("Failed to update bead");
    },
  });

  const { mutate: handleCloseBead } = useMutation({
    mutationFn: (id: string) => {
      const repoPath = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = repoPath?._repoPath as string | undefined;
      return closeBead(id, {}, repo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      toast.success("Bead closed");
    },
    onError: () => {
      toast.error("Failed to close bead");
    },
  });

  const hierarchicalData = useMemo(() => buildHierarchy(data), [data]);

  const sortedData = useMemo(() => {
    if (userSorted) return hierarchicalData;
    return [...hierarchicalData].sort((a, b) => {
      const aVerify = a.labels?.includes("stage:verification") ? 0 : 1;
      const bVerify = b.labels?.includes("stage:verification") ? 0 : 1;
      return aVerify - bVerify;
    });
  }, [hierarchicalData, userSorted]);

  const columns = useMemo(
    () => getBeadColumns({
      showRepoColumn,
      onUpdateBead: (id, fields) => handleUpdateBead({ id, fields }),
      onCloseBead: (id) => handleCloseBead(id),
      onTitleClick: (bead) => {
        const repoPath = (bead as unknown as Record<string, unknown>)._repoPath as string | undefined;
        const qs = repoPath ? `?repo=${encodeURIComponent(repoPath)}` : "";
        router.push(`/beads/${bead.id}${qs}`);
      },
    }),
    [showRepoColumn, handleUpdateBead, handleCloseBead, router]
  );

  const handleRowFocus = useCallback((bead: Bead) => {
    setFocusedRowId(bead.id);
    onRowFocus?.(bead);
  }, [onRowFocus]);

  useEffect(() => {
    setRowSelection({});
  }, [selectionVersion]);

  const table = useReactTable({
    data: sortedData,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: (updater) => {
      setSorting(updater);
      setUserSorted(true);
    },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: getStoredPageSize() } },
  });

  const selectedIds = table.getFilteredSelectedRowModel().rows.map((r) => r.original.id);
  const selectedKey = selectedIds.join(",");

  useEffect(() => {
    onSelectionChange?.(selectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, onSelectionChange]);

  useEffect(() => {
    const rows = table.getRowModel().rows;
    if (rows.length > 0 && !focusedRowId) {
      const first = rows[0].original;
      setFocusedRowId(first.id);
      onRowFocus?.(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getRowModel().rows.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const rows = table.getRowModel().rows;
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((r) => r.original.id === focusedRowId);
      let nextIndex: number;
      if (e.key === "ArrowDown") {
        nextIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : currentIndex;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }
      if (nextIndex !== currentIndex) {
        e.preventDefault();
        const nextBead = rows[nextIndex].original;
        setFocusedRowId(nextBead.id);
        onRowFocus?.(nextBead);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedRowId, table, onRowFocus]);

  return (
    <div className="space-y-4">
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
                className={focusedRowId === row.original.id ? "bg-muted/50" : ""}
                onClick={() => handleRowFocus(row.original)}
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

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(v) => {
              const size = Number(v);
              table.setPageSize(size);
              localStorage.setItem(PAGE_SIZE_KEY, String(size));
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
    </div>
  );
}
