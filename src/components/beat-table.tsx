"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { updateBead, closeBead, previewCascadeClose, cascadeCloseBead } from "@/lib/api";
import { buildHierarchy, type HierarchicalBeat } from "@/lib/beat-hierarchy";
import { compareBeatsByHierarchicalOrder } from "@/lib/beat-sort";
import { getBeatColumns, rejectBeatFields, verifyBeatFields } from "@/components/beat-columns";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { HotkeyHelp } from "@/components/hotkey-help";
import { NotesDialog } from "@/components/notes-dialog";
import { useAppStore } from "@/stores/app-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import { isInternalLabel, isReadOnlyLabel } from "@/lib/wave-slugs";
import { CascadeCloseDialog } from "@/components/cascade-close-dialog";
import type { CascadeDescendant } from "@/lib/cascade-close";

function isVerificationState(beat: Beat): boolean {
  return beat.state === "ready_for_implementation_review" || beat.state === "verification";
}

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

function InlineSummary({ beat }: { beat: Beat }) {
  const [expanded, setExpanded] = useState(false);
  if (!beat.description && !beat.notes) return null;

  return (
    <div
      className={`mt-1.5 flex text-xs leading-relaxed ${expanded ? "relative z-10" : ""}`}
      onMouseLeave={() => setExpanded(false)}
    >
      <SummaryColumn
        text={beat.description || ""}
        bg="bg-green-50"
        rounded="rounded-l"
        expanded={expanded}
        onExpand={() => setExpanded(true)}
      />
      <SummaryColumn
        text={beat.notes || ""}
        bg={beat.notes ? "bg-yellow-50" : ""}
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

const EXPANDED_PARENTS_KEY = "foolery:expandedParents";

function getStoredExpandedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(EXPANDED_PARENTS_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return new Set(parsed);
    return new Set();
  } catch {
    return new Set();
  }
}

function persistExpandedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) localStorage.removeItem(EXPANDED_PARENTS_KEY);
    else localStorage.setItem(EXPANDED_PARENTS_KEY, JSON.stringify([...ids]));
  } catch { /* localStorage unavailable */ }
}

export function BeatTable({
  data,
  showRepoColumn = false,
  onSelectionChange,
  selectionVersion,
  searchQuery,
  onOpenBeat,
  onShipBeat,
  shippingByBeatId = {},
  onAbortShipping,
}: {
  data: Beat[];
  showRepoColumn?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  selectionVersion?: number;
  searchQuery?: string;
  onOpenBeat?: (beat: Beat) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId?: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
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
  const [notesBeat, setNotesBeat] = useState<Beat | null>(null);
  const [notesRejectionMode, setNotesRejectionMode] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(getStoredExpandedIds);
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [rejectingIds, setRejectingIds] = useState<Set<string>>(new Set());
  const [manualPageIndex, setManualPageIndex] = useState(0);
  const [cascadeDialogOpen, setCascadeDialogOpen] = useState(false);
  const [cascadeBeat, setCascadeBeat] = useState<Beat | null>(null);
  const [cascadeDescendants, setCascadeDescendants] = useState<CascadeDescendant[]>([]);
  const [cascadeLoading, setCascadeLoading] = useState(false);
  const { activeRepo, registeredRepos, filters, pageSize } = useAppStore();
  const updateUrl = useUpdateUrl();
  const filtersKey = JSON.stringify(filters);

  const { mutate: handleUpdateBeat } = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: UpdateBeatInput }) => {
      const beat = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = beat?._repoPath as string | undefined;
      return updateBead(id, fields, repo);
    },
    onMutate: async ({ id, fields }) => {
      const isVerify = fields.state === "shipped";
      const isReject = fields.state === "retake" || fields.state === "open";

      // For ALL property changes: optimistically update the beads cache
      await queryClient.cancelQueries({ queryKey: ["beads"] });
      const previousBeads = queryClient.getQueriesData({ queryKey: ["beads"] });

      queryClient.setQueriesData(
        { queryKey: ["beads"] },
        (old: unknown) => {
          const prev = old as { ok: boolean; data?: Beat[] } | undefined;
          if (!prev?.data) return prev;
          if (isVerify || isReject) {
            return { ...prev, data: prev.data.filter((b) => b.id !== id) };
          }
          return {
            ...prev,
            data: prev.data.map((b) =>
              b.id === id ? { ...b, ...fields, updated: new Date().toISOString() } : b
            ),
          };
        }
      );

      if (!isVerify && !isReject) {
        return { isVerify: false as const, isReject: false as const, previousBeads };
      }

      const beat = data.find((b) => b.id === id);
      if (isVerify) {
        toast.success(`Verified: ${beat?.title ?? id}`);
        setVerifyingIds((prev) => new Set(prev).add(id));
      } else {
        toast.info(`Rejected: ${beat?.title ?? id}`);
        setRejectingIds((prev) => new Set(prev).add(id));
      }

      return { isVerify: isVerify as boolean, isReject: isReject as boolean, previousBeads };
    },
    onSuccess: () => {
      // Invalidation is handled in onSettled for all cases
    },
    onError: (_err, { id }, context) => {
      toast.error("Failed to update beat");
      if (context?.previousBeads) {
        for (const [key, snapData] of context.previousBeads) {
          queryClient.setQueryData(key, snapData);
        }
      }
      if (context?.isVerify) {
        setVerifyingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      if (context?.isReject) {
        setRejectingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    onSettled: (_data, _err, { id }, context) => {
      setVerifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setRejectingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (context?.isVerify || context?.isReject) {
        queryClient.invalidateQueries({
          queryKey: ["beads"],
          predicate: (query) =>
            !(query.queryKey.length >= 2 && query.queryKey[1] === "finalcut"),
        });
        queryClient.invalidateQueries({ queryKey: ["bead", id] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["beads"] });
        queryClient.invalidateQueries({ queryKey: ["bead", id] });
      }
    },
  });

  const { mutate: handleCloseBeat } = useMutation({
    mutationFn: (id: string) => {
      const beat = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = beat?._repoPath as string | undefined;
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

  const { mutate: handleCascadeClose } = useMutation({
    mutationFn: (id: string) => {
      const beat = data.find((b) => b.id === id) as unknown as Record<string, unknown>;
      const repo = beat?._repoPath as string | undefined;
      return cascadeCloseBead(id, {}, repo);
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      const beat = data.find((b) => b.id === id);
      toast.success(`Closed ${beat?.title ?? id} and all children`);
      setCascadeDialogOpen(false);
      setCascadeBeat(null);
      setCascadeDescendants([]);
    },
    onError: () => {
      toast.error("Failed to cascade close");
    },
  });

  /** Check if a beat has open children; if so, show cascade dialog. */
  const initiateClose = useCallback(
    async (beatId: string) => {
      const hasChildren = data.some(
        (b) => b.parent === beatId && b.state !== "shipped" && b.state !== "closed"
      );
      if (!hasChildren) {
        handleCloseBeat(beatId);
        return;
      }
      const beat = data.find((b) => b.id === beatId);
      if (!beat) return;
      setCascadeBeat(beat);
      setCascadeLoading(true);
      setCascadeDialogOpen(true);
      const repo = (beat as unknown as Record<string, unknown>)?._repoPath as string | undefined;
      const result = await previewCascadeClose(beatId, repo);
      setCascadeLoading(false);
      if (result.ok && result.data) {
        setCascadeDescendants(result.data.descendants);
      }
    },
    [data, handleCloseBeat],
  );

  const handleToggleCollapse = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistExpandedIds(next);
      return next;
    });
  }, []);

  const hierarchyData = useMemo(() => {
    const sortFn = userSorted ? undefined : compareBeatsByHierarchicalOrder;
    return buildHierarchy(data, sortFn);
  }, [data, userSorted]);

  const sortedData = useMemo(() => {
    const parentIds = new Set<string>();
    for (const beat of hierarchyData) {
      if ((beat as unknown as { _hasChildren?: boolean })._hasChildren) {
        parentIds.add(beat.id);
      }
    }

    const result: HierarchicalBeat[] = [];
    let skipDepth: number | null = null;
    for (const beat of hierarchyData) {
      if (skipDepth !== null && beat._depth > skipDepth) continue;
      skipDepth = null;
      result.push(beat);
      if (parentIds.has(beat.id) && !expandedIds.has(beat.id)) {
        skipDepth = beat._depth;
      }
    }
    return result;
  }, [hierarchyData, expandedIds]);

  const { paginatedData, manualPageCount } = useMemo(() => {
    const groups: HierarchicalBeat[][] = [];
    let currentGroup: HierarchicalBeat[] | null = null;

    for (const beat of sortedData) {
      if (beat._depth === 0) {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = [beat];
      } else {
        if (currentGroup) currentGroup.push(beat);
        else groups.push([beat]);
      }
    }
    if (currentGroup) groups.push(currentGroup);

    const pgCount = Math.max(1, Math.ceil(groups.length / pageSize));
    const startGroup = manualPageIndex * pageSize;
    const pageGroups = groups.slice(startGroup, startGroup + pageSize);
    return { paginatedData: pageGroups.flat(), manualPageCount: pgCount };
  }, [sortedData, pageSize, manualPageIndex]);

  useEffect(() => {
    setManualPageIndex(0);
  }, [sortedData.length, filtersKey]);

  const allLabels = useMemo(() => {
    const labelSet = new Set<string>();
    data.forEach((beat) => beat.labels?.forEach((l) => {
      if (!isInternalLabel(l) && !isReadOnlyLabel(l)) labelSet.add(l);
    }));
    return Array.from(labelSet).sort();
  }, [data]);

  const builtForReviewIds = useMemo(() => {
    const byParent = new Map<string, Beat[]>();
    for (const beat of data) {
      if (!beat.parent) continue;
      const list = byParent.get(beat.parent) ?? [];
      list.push(beat);
      byParent.set(beat.parent, list);
    }
    const result = new Set<string>();
    for (const [parentId, children] of byParent) {
      const hasVerification = children.some(
        (c) => c.state !== "closed" && c.state !== "shipped" && isVerificationState(c)
      );
      if (!hasVerification) continue;
      const allSettled = children.every(
        (c) =>
          c.state === "closed" || c.state === "shipped" || isVerificationState(c)
      );
      if (allSettled) result.add(parentId);
    }
    return result;
  }, [data]);

  const handleApproveReview = useCallback((parentId: string) => {
    const children = data.filter(
      (b) => b.parent === parentId && b.state !== "closed" && b.state !== "shipped" && isVerificationState(b)
    );
    for (const child of children) {
      handleUpdateBeat({ id: child.id, fields: verifyBeatFields() });
    }
    handleCloseBeat(parentId);
  }, [data, handleUpdateBeat, handleCloseBeat]);

  const handleRejectReview = useCallback((parentId: string) => {
    const children = data.filter(
      (b) => b.parent === parentId && b.state !== "closed" && b.state !== "shipped" && isVerificationState(b)
    );
    for (const child of children) {
      handleUpdateBeat({ id: child.id, fields: rejectBeatFields(child) });
    }
  }, [data, handleUpdateBeat]);

  const handleRejectBeat = useCallback((beat: Beat) => {
    setNotesBeat(beat);
    setNotesRejectionMode(true);
    setNotesDialogOpen(true);
  }, []);

  const childCountMap = useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    for (const beat of data) {
      if (beat.parent) {
        const list = childrenOf.get(beat.parent) ?? [];
        list.push(beat.id);
        childrenOf.set(beat.parent, list);
      }
    }
    const map = new Map<string, number>();
    function countDescendants(id: string): number {
      const kids = childrenOf.get(id);
      if (!kids) return 0;
      let total = 0;
      for (const kid of kids) {
        if (!childrenOf.has(kid)) total += 1;
        total += countDescendants(kid);
      }
      return total;
    }
    for (const pid of childrenOf.keys()) {
      const count = countDescendants(pid);
      if (count > 0) map.set(pid, count);
    }
    return map;
  }, [data]);

  const collapsedIds = useMemo(() => {
    const parentIds = new Set<string>();
    for (const beat of hierarchyData) {
      if ((beat as unknown as { _hasChildren?: boolean })._hasChildren) {
        parentIds.add(beat.id);
      }
    }
    const collapsed = new Set<string>();
    for (const id of parentIds) {
      if (!expandedIds.has(id)) collapsed.add(id);
    }
    return collapsed;
  }, [hierarchyData, expandedIds]);

  const columns = useMemo(
    () => getBeatColumns({
      showRepoColumn,
      onUpdateBeat: (id, fields) => handleUpdateBeat({ id, fields }),
      onTitleClick: (beat) => {
        if (onOpenBeat) {
          onOpenBeat(beat);
          return;
        }

        const repoPath = (beat as unknown as Record<string, unknown>)._repoPath as string | undefined;
        const params = new URLSearchParams(searchParams.toString());
        params.set("bead", beat.id);
        if (repoPath) params.set("detailRepo", repoPath);
        else params.delete("detailRepo");
        const qs = params.toString();
        router.push(`/beads${qs ? `?${qs}` : ""}`);
      },
      onShipBeat,
      shippingByBeatId,
      onAbortShipping,
      allLabels,
      builtForReviewIds,
      onApproveReview: handleApproveReview,
      onRejectReview: handleRejectReview,
      onRejectBeat: handleRejectBeat,
      onCloseBeat: initiateClose,
      collapsedIds,
      onToggleCollapse: handleToggleCollapse,
      childCountMap,
    }),
    [showRepoColumn, handleUpdateBeat, onOpenBeat, searchParams, router, onShipBeat, shippingByBeatId, onAbortShipping, allLabels, builtForReviewIds, handleApproveReview, handleRejectReview, handleRejectBeat, initiateClose, collapsedIds, handleToggleCollapse, childCountMap]
  );

  const handleRowFocus = useCallback((beat: Beat) => {
    setFocusedRowId(beat.id);
  }, []);

  useEffect(() => {
    setRowSelection({});
  }, [selectionVersion]);

  useEffect(() => {
    setRowSelection({});
  }, [activeRepo]);

  const table = useReactTable({
    data: paginatedData,
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

  useEffect(() => {
    const rows = table.getRowModel().rows;
    const firstId = rows.length > 0 ? rows[0].original.id : null;
    setFocusedRowId(firstId);
    const timer = setTimeout(() => {
      tableContainerRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useBeatTableKeyboard({
    focusedRowId,
    setFocusedRowId,
    table,
    tableContainerRef,
    handleUpdateBeat,
    initiateClose,
    onShipBeat,
    hotkeyHelpOpen,
    setHotkeyHelpOpen,
    setNotesBeat,
    setNotesDialogOpen,
    setNotesRejectionMode,
    activeRepo,
    registeredRepos,
    updateUrl,
    setExpandedIds,
  });

  return (
    <div ref={tableContainerRef} tabIndex={-1} className="space-y-1 outline-none">
      <BeatTableContent
        table={table}
        columns={columns}
        focusedRowId={focusedRowId}
        verifyingIds={verifyingIds}
        rejectingIds={rejectingIds}
        handleRowFocus={handleRowFocus}
        searchQuery={searchQuery}
        searchParams={searchParams}
        router={router}
      />

      {manualPageCount > 1 && (
        <BeatTablePagination
          manualPageIndex={manualPageIndex}
          manualPageCount={manualPageCount}
          pageSize={pageSize}
          setManualPageIndex={setManualPageIndex}
          updateUrl={updateUrl}
        />
      )}

      <HotkeyHelp open={hotkeyHelpOpen} />
      <NotesDialog
        bead={notesBeat}
        open={notesDialogOpen}
        rejectionMode={notesRejectionMode}
        onOpenChange={(open) => {
          setNotesDialogOpen(open);
          if (!open) setNotesRejectionMode(false);
        }}
        onUpdate={(id, fields) => handleUpdateBeat({ id, fields })}
      />
      <CascadeCloseDialog
        open={cascadeDialogOpen}
        onOpenChange={(open) => {
          setCascadeDialogOpen(open);
          if (!open) {
            setCascadeBeat(null);
            setCascadeDescendants([]);
          }
        }}
        parentTitle={cascadeBeat?.title ?? ""}
        descendants={cascadeDescendants}
        loading={cascadeLoading}
        onConfirm={() => {
          if (cascadeBeat) handleCascadeClose(cascadeBeat.id);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Extracted sub-components to keep BeatTable under the line limit            */
/* -------------------------------------------------------------------------- */

function BeatTableContent({
  table,
  columns,
  focusedRowId,
  verifyingIds,
  rejectingIds,
  handleRowFocus,
  searchQuery,
  searchParams,
  router,
}: {
  table: ReturnType<typeof useReactTable<Beat>>;
  columns: ReturnType<typeof getBeatColumns>;
  focusedRowId: string | null;
  verifyingIds: Set<string>;
  rejectingIds: Set<string>;
  handleRowFocus: (beat: Beat) => void;
  searchQuery?: string;
  searchParams: ReturnType<typeof useSearchParams>;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                style={{
                  width: (header.column.columnDef.meta as Record<string, string> | undefined)?.widthPercent
                    ?? (header.column.columnDef.maxSize! < Number.MAX_SAFE_INTEGER ? header.getSize() : undefined),
                }}
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
          table.getRowModel().rows.map((row) => {
            const isVerifying = verifyingIds.has(row.original.id);
            const isRejecting = rejectingIds.has(row.original.id);
            return (
            <TableRow
              key={row.id}
              className={cn(
                focusedRowId === row.original.id && "bg-muted/50",
                isVerifying && "bg-green-50 opacity-50 transition-all duration-300 dark:bg-green-950/30",
                isRejecting && "bg-red-50 opacity-50 transition-all duration-300 dark:bg-red-950/30",
              )}
              onClick={() => handleRowFocus(row.original)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={
                    (cell.column.columnDef.meta as Record<string, string> | undefined)?.widthPercent
                      ? "whitespace-nowrap"
                      : cell.column.columnDef.maxSize! < Number.MAX_SAFE_INTEGER
                        ? undefined
                        : cn("whitespace-normal", cell.column.id === "title" ? "overflow-visible" : "overflow-hidden")
                  }
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  {focusedRowId === row.original.id &&
                    cell.column.id === "title" && (
                      <div style={{ paddingLeft: `${((row.original as unknown as { _depth?: number })._depth ?? 0) * 16 + 16}px` }}>
                        <InlineSummary beat={row.original} />
                      </div>
                    )}
                </TableCell>
              ))}
            </TableRow>
            );
          })
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
  );
}

function BeatTablePagination({
  manualPageIndex,
  manualPageCount,
  pageSize,
  setManualPageIndex,
  updateUrl,
}: {
  manualPageIndex: number;
  manualPageCount: number;
  pageSize: number;
  setManualPageIndex: (fn: (p: number) => number) => void;
  updateUrl: ReturnType<typeof useUpdateUrl>;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">
        Page {manualPageIndex + 1} of {manualPageCount}
      </div>
      <div className="flex items-center gap-1">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const size = Number(v);
            setManualPageIndex(() => 0);
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
          onClick={() => setManualPageIndex((p) => Math.max(0, p - 1))}
          disabled={manualPageIndex === 0}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Next page"
          onClick={() => setManualPageIndex((p) => Math.min(manualPageCount - 1, p + 1))}
          disabled={manualPageIndex >= manualPageCount - 1}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/** Keyboard handler hook extracted from BeatTable to stay within line limits. */
function useBeatTableKeyboard({
  focusedRowId,
  setFocusedRowId,
  table,
  tableContainerRef,
  handleUpdateBeat,
  initiateClose,
  onShipBeat,
  hotkeyHelpOpen,
  setHotkeyHelpOpen,
  setNotesBeat,
  setNotesDialogOpen,
  setNotesRejectionMode,
  activeRepo,
  registeredRepos,
  updateUrl,
  setExpandedIds,
}: {
  focusedRowId: string | null;
  setFocusedRowId: (id: string | null) => void;
  table: ReturnType<typeof useReactTable<Beat>>;
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
  handleUpdateBeat: (args: { id: string; fields: UpdateBeatInput }) => void;
  initiateClose: (id: string) => void;
  onShipBeat?: (beat: Beat) => void;
  hotkeyHelpOpen: boolean;
  setHotkeyHelpOpen: (fn: (prev: boolean) => boolean) => void;
  setNotesBeat: (beat: Beat | null) => void;
  setNotesDialogOpen: (open: boolean) => void;
  setNotesRejectionMode: (mode: boolean) => void;
  activeRepo: string | null;
  registeredRepos: { path: string }[];
  updateUrl: ReturnType<typeof useUpdateUrl>;
  setExpandedIds: (fn: (prev: Set<string>) => Set<string>) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT") return;

      const container = tableContainerRef.current;
      if (container && container.offsetParent === null) return;

      if (handleHotkeyToggle(e, setHotkeyHelpOpen)) return;
      if (handleLabelHotkey(e)) return;
      if (handleNotesHotkey(e, table, focusedRowId, setNotesBeat, setNotesDialogOpen)) return;

      const rows = table.getRowModel().rows;
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((r) => r.original.id === focusedRowId);

      if (handleNavigationKeys(e, rows, currentIndex, setFocusedRowId)) return;
      if (handleSpaceSelect(e, rows, currentIndex, setFocusedRowId)) return;
      handleActionKeys(e, rows, currentIndex, {
        setFocusedRowId, handleUpdateBeat, initiateClose,
        onShipBeat, setNotesBeat, setNotesDialogOpen, setNotesRejectionMode,
        activeRepo, registeredRepos, updateUrl, setExpandedIds,
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedRowId, table, handleUpdateBeat, initiateClose, onShipBeat, hotkeyHelpOpen, activeRepo, registeredRepos, updateUrl, tableContainerRef, setHotkeyHelpOpen, setNotesBeat, setNotesDialogOpen, setNotesRejectionMode, setExpandedIds, setFocusedRowId]);
}

/* --- Keyboard helper functions ------------------------------------------- */

function handleHotkeyToggle(
  e: KeyboardEvent,
  setHotkeyHelpOpen: (fn: (prev: boolean) => boolean) => void,
): boolean {
  if (e.key.toLowerCase() === "h" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    setHotkeyHelpOpen((prev) => {
      const next = !prev;
      localStorage.setItem(HOTKEY_HELP_KEY, String(next));
      return next;
    });
    return true;
  }
  return false;
}

function handleLabelHotkey(e: KeyboardEvent): boolean {
  if (e.key === "L" && e.shiftKey) {
    e.preventDefault();
    const focusedRow = document.querySelector("tr.bg-muted\\/50");
    if (focusedRow) {
      const addLabelBtn = focusedRow.querySelector("[data-add-label]") as HTMLButtonElement;
      if (addLabelBtn) addLabelBtn.click();
    }
    return true;
  }
  return false;
}

function handleNotesHotkey(
  e: KeyboardEvent,
  table: ReturnType<typeof useReactTable<Beat>>,
  focusedRowId: string | null,
  setNotesBeat: (beat: Beat | null) => void,
  setNotesDialogOpen: (open: boolean) => void,
): boolean {
  if (e.key === "O" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const rows = table.getRowModel().rows;
    const idx = rows.findIndex((r) => r.original.id === focusedRowId);
    if (idx >= 0) {
      setNotesBeat(rows[idx].original);
      setNotesDialogOpen(true);
    }
    return true;
  }
  return false;
}

function handleNavigationKeys(
  e: KeyboardEvent,
  rows: { original: Beat }[],
  currentIndex: number,
  setFocusedRowId: (id: string | null) => void,
): boolean {
  if (e.key === "ArrowDown") {
    const nextIndex = currentIndex < rows.length - 1 ? currentIndex + 1 : currentIndex;
    if (nextIndex !== currentIndex) {
      e.preventDefault();
      setFocusedRowId(rows[nextIndex].original.id);
    }
    return true;
  }
  if (e.key === "ArrowUp") {
    const nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    if (nextIndex !== currentIndex) {
      e.preventDefault();
      setFocusedRowId(rows[nextIndex].original.id);
    }
    return true;
  }
  return false;
}

function handleSpaceSelect(
  e: KeyboardEvent,
  rows: { original: Beat; toggleSelected: (v: boolean) => void; getIsSelected: () => boolean }[],
  currentIndex: number,
  setFocusedRowId: (id: string | null) => void,
): boolean {
  if (e.key === " ") {
    e.preventDefault();
    if (currentIndex < 0) return true;
    rows[currentIndex].toggleSelected(!rows[currentIndex].getIsSelected());
    if (currentIndex < rows.length - 1) {
      setFocusedRowId(rows[currentIndex + 1].original.id);
    }
    return true;
  }
  return false;
}

function handleActionKeys(
  e: KeyboardEvent,
  rows: { original: Beat }[],
  currentIndex: number,
  ctx: {
    setFocusedRowId: (id: string | null) => void;
    handleUpdateBeat: (args: { id: string; fields: UpdateBeatInput }) => void;
    initiateClose: (id: string) => void;
    onShipBeat?: (beat: Beat) => void;
    setNotesBeat: (beat: Beat | null) => void;
    setNotesDialogOpen: (open: boolean) => void;
    setNotesRejectionMode: (mode: boolean) => void;
    activeRepo: string | null;
    registeredRepos: { path: string }[];
    updateUrl: ReturnType<typeof useUpdateUrl>;
    setExpandedIds: (fn: (prev: Set<string>) => Set<string>) => void;
  },
): void {
  if (e.key === "V" && e.shiftKey) {
    if (currentIndex < 0) return;
    const beat = rows[currentIndex].original;
    if (beat.state === "shipped" || beat.state === "closed") return;
    e.preventDefault();
    ctx.handleUpdateBeat({ id: beat.id, fields: verifyBeatFields() });
    const nextFocusIdx = currentIndex < rows.length - 1 ? currentIndex + 1 : Math.max(0, currentIndex - 1);
    if (rows[nextFocusIdx] && rows[nextFocusIdx].original.id !== beat.id) {
      ctx.setFocusedRowId(rows[nextFocusIdx].original.id);
    }
  } else if (e.key === "F" && e.shiftKey) {
    if (currentIndex < 0) return;
    const beat = rows[currentIndex].original;
    if (!isVerificationState(beat)) return;
    e.preventDefault();
    ctx.setNotesBeat(beat);
    ctx.setNotesRejectionMode(true);
    ctx.setNotesDialogOpen(true);
  } else if (e.key === "S" && e.shiftKey) {
    if (!ctx.onShipBeat || currentIndex < 0) return;
    const beat = rows[currentIndex].original;
    if (beat.state === "shipped" || beat.state === "closed" || beat.type === "gate") return;
    e.preventDefault();
    ctx.onShipBeat(beat);
  } else if (e.key === "R" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (ctx.registeredRepos.length === 0) return;
    const cycle = ctx.registeredRepos.map((r) => r.path);
    const currentIdx = ctx.activeRepo ? cycle.indexOf(ctx.activeRepo) : -1;
    const prevIdx = currentIdx <= 0 ? cycle.length - 1 : currentIdx - 1;
    ctx.updateUrl({ repo: cycle[prevIdx] });
  } else if (e.key === "C" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    if (currentIndex < 0) return;
    const beat = rows[currentIndex].original;
    if (beat.state === "shipped" || beat.state === "closed") return;
    e.preventDefault();
    ctx.initiateClose(beat.id);
    const nextFocusIdx = currentIndex < rows.length - 1 ? currentIndex + 1 : Math.max(0, currentIndex - 1);
    if (rows[nextFocusIdx] && rows[nextFocusIdx].original.id !== beat.id) {
      ctx.setFocusedRowId(rows[nextFocusIdx].original.id);
    }
  } else if (e.key === "R" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    if (ctx.registeredRepos.length === 0) return;
    const cycle = ctx.registeredRepos.map((r) => r.path);
    const currentIdx = ctx.activeRepo ? cycle.indexOf(ctx.activeRepo) : -1;
    const nextIdx = currentIdx < cycle.length - 1 ? currentIdx + 1 : 0;
    ctx.updateUrl({ repo: cycle[nextIdx] });
  } else if (e.key === "<" && e.shiftKey) {
    if (currentIndex < 0) return;
    const hb = rows[currentIndex].original as unknown as { _hasChildren?: boolean; id: string };
    if (!hb._hasChildren) return;
    e.preventDefault();
    ctx.setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(rows[currentIndex].original.id);
      persistExpandedIds(next);
      return next;
    });
  } else if (e.key === ">" && e.shiftKey) {
    if (currentIndex < 0) return;
    const hb = rows[currentIndex].original as unknown as { _hasChildren?: boolean; id: string };
    if (!hb._hasChildren) return;
    e.preventDefault();
    ctx.setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(rows[currentIndex].original.id);
      persistExpandedIds(next);
      return next;
    });
  }
}
