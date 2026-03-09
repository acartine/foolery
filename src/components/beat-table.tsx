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
import { closeBeat, previewCascadeClose, cascadeCloseBeat } from "@/lib/api";
import { buildHierarchy, type HierarchicalBeat } from "@/lib/beat-hierarchy";
import { compareBeatsByHierarchicalOrder } from "@/lib/beat-sort";
import { getBeatColumns } from "@/components/beat-columns";
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
import { NotesDialog } from "@/components/notes-dialog";
import { useAppStore } from "@/stores/app-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import { isInternalLabel, isReadOnlyLabel } from "@/lib/wave-slugs";
import { CascadeCloseDialog } from "@/components/cascade-close-dialog";
import type { CascadeDescendant } from "@/lib/cascade-close";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";

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
    <div className={`min-w-0 basis-[37.5%] ${rounded} px-2 py-1 ${bg}`}>
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
      className={`mt-1.5 flex max-w-[75%] text-xs leading-relaxed ${expanded ? "relative z-10" : ""}`}
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

type ColumnMetaSizing = {
  widthPercent?: string;
  minWidthPx?: number;
};

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

function repoPathForBeat(beat: Beat | undefined): string | undefined {
  const record = beat as (Beat & { _repoPath?: unknown }) | undefined;
  const repoPath = record?._repoPath;
  return typeof repoPath === "string" && repoPath.trim().length > 0 ? repoPath : undefined;
}

export function BeatTable({
  data,
  showRepoColumn = false,
  showAgentColumns = false,
  agentInfoByBeatId = {},
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
  showAgentColumns?: boolean;
  agentInfoByBeatId?: Record<string, import("@/components/beat-columns").AgentInfo>;
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
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notesBeat, setNotesBeat] = useState<Beat | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(getStoredExpandedIds);
  const [manualPageIndex, setManualPageIndex] = useState(0);
  const [cascadeDialogOpen, setCascadeDialogOpen] = useState(false);
  const [cascadeBeat, setCascadeBeat] = useState<Beat | null>(null);
  const [cascadeDescendants, setCascadeDescendants] = useState<CascadeDescendant[]>([]);
  const [cascadeLoading, setCascadeLoading] = useState(false);
  const { activeRepo, registeredRepos, filters, pageSize } = useAppStore();
  const updateUrl = useUpdateUrl();
  const filtersKey = JSON.stringify(filters);

  const { mutate: handleUpdateBeat } = useMutation({
    mutationFn: ({ id, fields, repoPath }: { id: string; fields: UpdateBeatInput; repoPath?: string }) =>
      updateBeatOrThrow(data, id, fields, repoPath),
    onMutate: async ({ id, fields, repoPath }) => {
      // Optimistically update the beats cache
      await queryClient.cancelQueries({ queryKey: ["beats"] });
      const previousBeats = queryClient.getQueriesData({ queryKey: ["beats"] });

      queryClient.setQueriesData(
        { queryKey: ["beats"] },
        (old: unknown) => {
          const prev = old as { ok: boolean; data?: Beat[] } | undefined;
          if (!prev?.data) return prev;
          return {
            ...prev,
            data: prev.data.map((b) =>
              b.id === id && (repoPath === undefined || repoPathForBeat(b) === repoPath)
                ? { ...b, ...fields, updated: new Date().toISOString() }
                : b
            ),
          };
        }
      );

      return { previousBeats };
    },
    onError: (error, _vars, context) => {
      const message = error instanceof Error ? error.message : "Failed to update beat";
      toast.error(message);
      if (context?.previousBeats) {
        for (const [key, snapData] of context.previousBeats) {
          queryClient.setQueryData(key, snapData);
        }
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["beats"] });
      queryClient.invalidateQueries({ queryKey: ["beat", id] });
    },
  });

  const { mutate: handleCloseBeat } = useMutation({
    mutationFn: (id: string) => {
      const beat = data.find((b) => b.id === id);
      const repo = repoPathForBeat(beat);
      return closeBeat(id, {}, repo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beats"] });
      toast.success("Beat closed");
    },
    onError: () => {
      toast.error("Failed to close beat");
    },
  });

  const { mutate: handleCascadeClose } = useMutation({
    mutationFn: (id: string) => {
      const beat = data.find((b) => b.id === id);
      const repo = repoPathForBeat(beat);
      return cascadeCloseBeat(id, {}, repo);
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["beats"] });
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
      const repo = repoPathForBeat(beat);
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

  // Beats whose parent/ancestor is currently rolling — they inherit rolling visual state.
  const parentRollingBeatIds = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    for (const beat of data) {
      if (!beat.parent) continue;
      const children = childrenByParent.get(beat.parent) ?? [];
      children.push(beat.id);
      childrenByParent.set(beat.parent, children);
    }

    const ids = new Set<string>();
    const stack = Object.keys(shippingByBeatId).filter((beatId) => Boolean(shippingByBeatId[beatId]));

    while (stack.length > 0) {
      const parentId = stack.pop();
      if (!parentId) continue;
      const children = childrenByParent.get(parentId);
      if (!children) continue;

      for (const childId of children) {
        if (ids.has(childId)) continue;
        ids.add(childId);
        stack.push(childId);
      }
    }

    return ids;
  }, [data, shippingByBeatId]);

  const columns = useMemo(
    () => getBeatColumns({
      showRepoColumn,
      showAgentColumns,
      agentInfoByBeatId,
      onUpdateBeat: (id, fields, repoPath) => handleUpdateBeat({ id, fields, repoPath }),
      onTitleClick: (beat) => {
        if (onOpenBeat) {
          onOpenBeat(beat);
          return;
        }

        const repoPath = repoPathForBeat(beat);
        const params = new URLSearchParams(searchParams.toString());
        params.set("beat", beat.id);
        if (repoPath) params.set("detailRepo", repoPath);
        else params.delete("detailRepo");
        const qs = params.toString();
        router.push(`/beats${qs ? `?${qs}` : ""}`);
      },
      onShipBeat,
      shippingByBeatId,
      onAbortShipping,
      allLabels,
      onCloseBeat: initiateClose,
      collapsedIds,
      onToggleCollapse: handleToggleCollapse,
      childCountMap,
      parentRollingBeatIds,
    }),
    [showRepoColumn, showAgentColumns, agentInfoByBeatId, handleUpdateBeat, onOpenBeat, searchParams, router, onShipBeat, shippingByBeatId, onAbortShipping, allLabels, initiateClose, collapsedIds, handleToggleCollapse, childCountMap, parentRollingBeatIds]
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
    shippingByBeatId,
    parentRollingBeatIds,
    setNotesBeat,
    setNotesDialogOpen,
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

      <NotesDialog
        beat={notesBeat}
        open={notesDialogOpen}
        onOpenChange={setNotesDialogOpen}
        onUpdate={(id, fields) => handleUpdateBeat({ id, fields, repoPath: repoPathForBeat(notesBeat ?? undefined) })}
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
  handleRowFocus,
  searchQuery,
  searchParams,
  router,
}: {
  table: ReturnType<typeof useReactTable<Beat>>;
  columns: ReturnType<typeof getBeatColumns>;
  focusedRowId: string | null;
  handleRowFocus: (beat: Beat) => void;
  searchQuery?: string;
  searchParams: ReturnType<typeof useSearchParams>;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <Table className="table-auto">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta as ColumnMetaSizing | undefined;
              return (
                <TableHead
                  key={header.id}
                  style={{
                    width: meta?.widthPercent
                      ?? (header.column.columnDef.maxSize! < Number.MAX_SAFE_INTEGER ? header.getSize() : undefined),
                    minWidth: meta?.minWidthPx,
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
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(
                focusedRowId === row.original.id && "bg-muted/50",
              )}
              onClick={() => handleRowFocus(row.original)}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as ColumnMetaSizing | undefined;
                return (
                  <TableCell
                    key={cell.id}
                    className={
                      meta?.widthPercent || meta?.minWidthPx
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
                );
              })}
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
                      router.push(`/beats${qs ? `?${qs}` : ""}`);
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
  shippingByBeatId,
  parentRollingBeatIds,
  setNotesBeat,
  setNotesDialogOpen,
  activeRepo,
  registeredRepos,
  updateUrl,
  setExpandedIds,
}: {
  focusedRowId: string | null;
  setFocusedRowId: (id: string | null) => void;
  table: ReturnType<typeof useReactTable<Beat>>;
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
  handleUpdateBeat: (args: { id: string; fields: UpdateBeatInput; repoPath?: string }) => void;
  initiateClose: (id: string) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId: Record<string, string>;
  parentRollingBeatIds: Set<string>;
  setNotesBeat: (beat: Beat | null) => void;
  setNotesDialogOpen: (open: boolean) => void;
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

      if (handleLabelHotkey(e)) return;
      if (handleNotesHotkey(e, table, focusedRowId, setNotesBeat, setNotesDialogOpen)) return;

      const rows = table.getRowModel().rows;
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((r) => r.original.id === focusedRowId);

      if (handleNavigationKeys(e, rows, currentIndex, setFocusedRowId)) return;
      if (handleSpaceSelect(e, rows, currentIndex, setFocusedRowId)) return;
      handleActionKeys(e, rows, currentIndex, {
        setFocusedRowId, handleUpdateBeat, initiateClose,
        onShipBeat, shippingByBeatId, parentRollingBeatIds,
        setExpandedIds,
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedRowId, table, handleUpdateBeat, initiateClose, onShipBeat, shippingByBeatId, parentRollingBeatIds, tableContainerRef, setNotesBeat, setNotesDialogOpen, setExpandedIds, setFocusedRowId]);
}

/* --- Keyboard helper functions ------------------------------------------- */

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
    handleUpdateBeat: (args: { id: string; fields: UpdateBeatInput; repoPath?: string }) => void;
    initiateClose: (id: string) => void;
    onShipBeat?: (beat: Beat) => void;
    shippingByBeatId: Record<string, string>;
    parentRollingBeatIds: Set<string>;
    setExpandedIds: (fn: (prev: Set<string>) => Set<string>) => void;
  },
): void {
  if (e.key === "S" && e.shiftKey) {
    if (!ctx.onShipBeat || currentIndex < 0) return;
    const beat = rows[currentIndex].original;
    if (beat.state === "shipped" || beat.state === "closed" || beat.type === "gate") return;
    const isInheritedRolling = ctx.parentRollingBeatIds.has(beat.id) || Boolean(beat.parent && ctx.shippingByBeatId[beat.parent]);
    // Block Take! when parent/ancestor is rolling
    if (isInheritedRolling) return;
    e.preventDefault();
    ctx.onShipBeat(beat);
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
