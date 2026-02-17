"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { getBeadColumns, rejectBeadFields, verifyBeadFields } from "@/components/bead-columns";
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
import { ArrowUpDown, XCircle } from "lucide-react";
import { toast } from "sonner";
import { HotkeyHelp } from "@/components/hotkey-help";
import { NotesDialog } from "@/components/notes-dialog";
import { useTerminalStore } from "@/stores/terminal-store";
import { useAppStore } from "@/stores/app-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import { isInternalLabel, isReadOnlyLabel } from "@/lib/wave-slugs";

function SummaryColumn({
  text,
  bg,
  rounded,
  expanded,
  onExpand,
}: {
  text: string;
  bg: string;
  rounded: string;
  expanded: boolean;
  onExpand: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div className={`flex-1 ${rounded} px-2 py-1 ${bg} min-w-0`}>
      <div
        ref={ref}
        className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-[7]"}`}
      >
        {text}
      </div>
      {!expanded && overflows && (
        <button
          type="button" title="Expand full text"
          className="text-green-700 font-bold cursor-pointer mt-0.5"
          onMouseEnter={onExpand}
        >
          ...show more...
        </button>
      )}
    </div>
  );
}

function InlineSummary({ bead }: { bead: Bead }) {
  const [expanded, setExpanded] = useState(false);
  if (!bead.description && !bead.notes) return null;

  return (
    <div
      className={`mt-1.5 flex text-xs leading-relaxed ${expanded ? "relative z-10" : ""}`}
      onMouseLeave={() => setExpanded(false)}
    >
      <SummaryColumn
        text={bead.description || ""}
        bg="bg-green-50"
        rounded="rounded-l"
        expanded={expanded}
        onExpand={() => setExpanded(true)}
      />
      <SummaryColumn
        text={bead.notes || ""}
        bg={bead.notes ? "bg-yellow-50" : ""}
        rounded="rounded-r"
        expanded={expanded}
        onExpand={() => setExpanded(true)}
      />
    </div>
  );
}

const HOTKEY_HELP_KEY = "foolery-hotkey-help";

function getStoredHotkeyHelp(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(HOTKEY_HELP_KEY);
  if (stored === null) return true;
  return stored !== "false";
}

export function BeadTable({
  data,
  showRepoColumn = false,
  onSelectionChange,
  selectionVersion,
  searchQuery,
  onOpenBead,
  onShipBead,
  shippingByBeadId = {},
  onAbortShipping,
}: {
  data: Bead[];
  showRepoColumn?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  selectionVersion?: number;
  searchQuery?: string;
  onOpenBead?: (bead: Bead) => void;
  onShipBead?: (bead: Bead) => void;
  shippingByBeadId?: Record<string, string>;
  onAbortShipping?: (beadId: string) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [userSorted, setUserSorted] = useState(false);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [hotkeyHelpOpen, setHotkeyHelpOpen] = useState(getStoredHotkeyHelp);
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notesBead, setNotesBead] = useState<Bead | null>(null);
  const { togglePanel: toggleTerminalPanel } = useTerminalStore();
  const { activeRepo, registeredRepos, filters, pageSize } = useAppStore();
  const updateUrl = useUpdateUrl();
  const filtersKey = JSON.stringify(filters);

  const { mutate: handleUpdateBead } = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: UpdateBeadInput }) => {
      const bead = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = bead?._repoPath as string | undefined;
      return updateBead(id, fields, repo);
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      queryClient.invalidateQueries({ queryKey: ["bead", id] });
    },
    onError: () => {
      toast.error("Failed to update beat");
    },
  });

  const { mutate: handleCloseBead } = useMutation({
    mutationFn: (id: string) => {
      const bead = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = bead?._repoPath as string | undefined;
      return closeBead(id, {}, repo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      toast.success("Beat closed");
    },
    onError: () => {
      toast.error("Failed to close beat");
    },
  });

  const sortedData = useMemo(() => {
    const sortFn = userSorted ? undefined : (a: Bead, b: Bead) => {
      const aClosed = a.status === "closed" ? 1 : 0;
      const bClosed = b.status === "closed" ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;
      const aV = a.labels?.includes("stage:verification") ? 0 : 1;
      const bV = b.labels?.includes("stage:verification") ? 0 : 1;
      return aV - bV;
    };
    return buildHierarchy(data, sortFn);
  }, [data, userSorted]);

  const allLabels = useMemo(() => {
    const labelSet = new Set<string>();
    data.forEach((bead) => bead.labels?.forEach((l) => {
      if (!isInternalLabel(l) && !isReadOnlyLabel(l)) labelSet.add(l);
    }));
    return Array.from(labelSet).sort();
  }, [data]);

  // Detect parent beads whose children are all in verification (or closed)
  const builtForReviewIds = useMemo(() => {
    const byParent = new Map<string, Bead[]>();
    for (const bead of data) {
      if (!bead.parent) continue;
      const list = byParent.get(bead.parent) ?? [];
      list.push(bead);
      byParent.set(bead.parent, list);
    }
    const result = new Set<string>();
    for (const [parentId, children] of byParent) {
      const hasVerification = children.some(
        (c) => c.status === "in_progress" && c.labels?.includes("stage:verification")
      );
      if (!hasVerification) continue;
      const allSettled = children.every(
        (c) =>
          c.status === "closed" ||
          (c.status === "in_progress" && c.labels?.includes("stage:verification"))
      );
      if (allSettled) result.add(parentId);
    }
    return result;
  }, [data]);

  // Approve all verification children under a parent and close the parent
  const handleApproveReview = useCallback((parentId: string) => {
    const children = data.filter(
      (b) => b.parent === parentId && b.status === "in_progress" && b.labels?.includes("stage:verification")
    );
    for (const child of children) {
      // Use the shared atomic verify payload to avoid split-update regressions.
      handleUpdateBead({ id: child.id, fields: verifyBeadFields() });
    }
    handleCloseBead(parentId);
  }, [data, handleUpdateBead, handleCloseBead]);

  // Reject all verification children under a parent back to open
  const handleRejectReview = useCallback((parentId: string) => {
    const children = data.filter(
      (b) => b.parent === parentId && b.status === "in_progress" && b.labels?.includes("stage:verification")
    );
    for (const child of children) {
      handleUpdateBead({ id: child.id, fields: rejectBeadFields(child) });
    }
  }, [data, handleUpdateBead]);

  const columns = useMemo(
    () => getBeadColumns({
      showRepoColumn,
      onUpdateBead: (id, fields) => handleUpdateBead({ id, fields }),
      onTitleClick: (bead) => {
        if (onOpenBead) {
          onOpenBead(bead);
          return;
        }

        const repoPath = (bead as unknown as Record<string, unknown>)._repoPath as string | undefined;
        const params = new URLSearchParams(searchParams.toString());
        params.set("bead", bead.id);
        if (repoPath) params.set("detailRepo", repoPath);
        else params.delete("detailRepo");
        const qs = params.toString();
        router.push(`/beads${qs ? `?${qs}` : ""}`);
      },
      onShipBead,
      shippingByBeadId,
      onAbortShipping,
      allLabels,
      builtForReviewIds,
      onApproveReview: handleApproveReview,
      onRejectReview: handleRejectReview,
    }),
    [showRepoColumn, handleUpdateBead, onOpenBead, searchParams, router, onShipBead, shippingByBeadId, onAbortShipping, allLabels, builtForReviewIds, handleApproveReview, handleRejectReview]
  );

  const handleRowFocus = useCallback((bead: Bead) => {
    setFocusedRowId(bead.id);
  }, []);

  useEffect(() => {
    setRowSelection({});
  }, [selectionVersion]);

  // Clear selection when active repo changes
  useEffect(() => {
    setRowSelection({});
  }, [activeRepo]);

  const table = useReactTable({
    data: sortedData,
    columns,
    state: { sorting, rowSelection },
    getRowId: (row) => row.id,
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
    initialState: { pagination: { pageSize } },
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
      setFocusedRowId(rows[0].original.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getRowModel().rows.length]);

  // Reset focus to first row when filters change
  useEffect(() => {
    const rows = table.getRowModel().rows;
    const firstId = rows.length > 0 ? rows[0].original.id : null;
    setFocusedRowId(firstId);
    // Use setTimeout to defer past Radix Select's async focus cleanup
    const timer = setTimeout(() => {
      tableContainerRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT") return;

      // Skip keyboard handling when this table is hidden (e.g. another view tab is active)
      const container = tableContainerRef.current;
      if (container && container.offsetParent === null) return;

      if (
        e.key.toLowerCase() === "h" &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        setHotkeyHelpOpen((prev) => {
          const next = !prev;
          localStorage.setItem(HOTKEY_HELP_KEY, String(next));
          return next;
        });
        return;
      }

      if (e.key === "L" && e.shiftKey) {
        e.preventDefault();
        const focusedRow = document.querySelector("tr.bg-muted\\/50");
        if (focusedRow) {
          const addLabelBtn = focusedRow.querySelector("[data-add-label]") as HTMLButtonElement;
          if (addLabelBtn) addLabelBtn.click();
        }
        return;
      }

      if (e.key === "O" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const rows = table.getRowModel().rows;
        const idx = rows.findIndex((r) => r.original.id === focusedRowId);
        if (idx >= 0) {
          setNotesBead(rows[idx].original);
          setNotesDialogOpen(true);
        }
        return;
      }

      const rows = table.getRowModel().rows;
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((r) => r.original.id === focusedRowId);

      if (e.key === "ArrowDown") {
        const nextIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : currentIndex;
        if (nextIndex !== currentIndex) {
          e.preventDefault();
          setFocusedRowId(rows[nextIndex].original.id);
        }
      } else if (e.key === "ArrowUp") {
        const nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        if (nextIndex !== currentIndex) {
          e.preventDefault();
          setFocusedRowId(rows[nextIndex].original.id);
        }
      } else if (e.key === " ") {
        // Space: toggle selection on focused row and advance
        e.preventDefault();
        if (currentIndex < 0) return;
        rows[currentIndex].toggleSelected(!rows[currentIndex].getIsSelected());
        if (currentIndex < rows.length - 1) {
          setFocusedRowId(rows[currentIndex + 1].original.id);
        }
      } else if (e.key === "V" && e.shiftKey) {
        // Shift-V: Verify (close) via one atomic update (status + label removal).
        if (currentIndex < 0) return;
        const bead = rows[currentIndex].original;
        if (!bead.labels?.includes("stage:verification")) return;
        e.preventDefault();
        handleUpdateBead({ id: bead.id, fields: verifyBeadFields() });
        // Advance focus to the next row (or previous if at end)
        const nextFocusIdx = currentIndex < rows.length - 1 ? currentIndex + 1 : Math.max(0, currentIndex - 1);
        if (rows[nextFocusIdx] && rows[nextFocusIdx].original.id !== bead.id) {
          setFocusedRowId(rows[nextFocusIdx].original.id);
        }
      } else if (e.key === "F" && e.shiftKey) {
        // Shift-F: Reject the focused bead if it has stage:verification
        if (currentIndex < 0) return;
        const bead = rows[currentIndex].original;
        if (!bead.labels?.includes("stage:verification")) return;
        e.preventDefault();
        handleUpdateBead({ id: bead.id, fields: rejectBeadFields(bead) });
      } else if (e.key === "S" && e.shiftKey) {
        // Shift-S: Ship focused bead
        if (!onShipBead || currentIndex < 0) return;
        const bead = rows[currentIndex].original;
        if (bead.status === "closed" || bead.type === "gate") return;
        e.preventDefault();
        onShipBead(bead);
      } else if (e.key === "T" && e.shiftKey) {
        // Shift-T: Toggle terminal panel
        e.preventDefault();
        toggleTerminalPanel();
      } else if (e.key === "R" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        // Cmd+Shift+R: previous repo
        e.preventDefault();
        if (registeredRepos.length === 0) return;
        const cycle = registeredRepos.map((r) => r.path);
        const currentIdx = activeRepo ? cycle.indexOf(activeRepo) : -1;
        const prevIdx = currentIdx <= 0 ? cycle.length - 1 : currentIdx - 1;
        updateUrl({ repo: cycle[prevIdx] });
      } else if (e.key === "C" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Shift+C: Close focused bead
        if (currentIndex < 0) return;
        const bead = rows[currentIndex].original;
        if (bead.status === "closed") return;
        e.preventDefault();
        handleCloseBead(bead.id);
        const nextFocusIdx = currentIndex < rows.length - 1 ? currentIndex + 1 : Math.max(0, currentIndex - 1);
        if (rows[nextFocusIdx] && rows[nextFocusIdx].original.id !== bead.id) {
          setFocusedRowId(rows[nextFocusIdx].original.id);
        }
      } else if (e.key === "R" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Shift+R: next repo
        e.preventDefault();
        if (registeredRepos.length === 0) return;
        const cycle = registeredRepos.map((r) => r.path);
        const currentIdx = activeRepo ? cycle.indexOf(activeRepo) : -1;
        const nextIdx = currentIdx < cycle.length - 1 ? currentIdx + 1 : 0;
        updateUrl({ repo: cycle[nextIdx] });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedRowId, table, handleUpdateBead, handleCloseBead, onShipBead, toggleTerminalPanel, hotkeyHelpOpen, activeRepo, registeredRepos, updateUrl]);

  return (
    <div ref={tableContainerRef} tabIndex={-1} className="space-y-1 outline-none">
      <Table className="table-fixed">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  style={{ width: header.column.columnDef.maxSize! < Number.MAX_SAFE_INTEGER ? header.getSize() : undefined }}
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      title="Sort column"
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
                  <TableCell
                    key={cell.id}
                    className={cell.column.columnDef.maxSize! < Number.MAX_SAFE_INTEGER ? undefined : "whitespace-normal overflow-hidden"}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    {focusedRowId === row.original.id &&
                      cell.column.id === "title" && (
                        <div style={{ paddingLeft: `${((row.original as unknown as { _depth?: number })._depth ?? 0) * 16}px` }}>
                          <InlineSummary bead={row.original} />
                        </div>
                      )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-10 text-center"
              >
                {searchQuery ? (
                  <div className="flex items-center justify-center gap-2">
                    <span>No results for &ldquo;{searchQuery}&rdquo;</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      title="Clear search query"
                      onClick={() => {
                        const params = new URLSearchParams(searchParams.toString());
                        params.delete("q");
                        const qs = params.toString();
                        router.push(`/beads${qs ? `?${qs}` : ""}`);
                      }}
                    >
                      <XCircle className="size-3.5" />
                      Clear search
                    </Button>
                  </div>
                ) : (
                  "No beats found."
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </div>
          <div className="flex items-center gap-1">
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(v) => {
                const size = Number(v);
                table.setPageSize(size);
                updateUrl({ pageSize: size });
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
              title="Previous page"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Next page"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <HotkeyHelp open={hotkeyHelpOpen} />
      <NotesDialog
        bead={notesBead}
        open={notesDialogOpen}
        onOpenChange={setNotesDialogOpen}
        onUpdate={(id, fields) => handleUpdateBead({ id, fields })}
      />
    </div>
  );
}
