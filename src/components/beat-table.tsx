"use client";

import { useState, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import type { Beat } from "@/lib/types";
import {
  BeatTableContent,
} from "@/components/beat-table-content";
import { PerfProfiler } from "@/components/perf-profiler";
import {
  BeatTablePagination,
} from "@/components/beat-table-pagination";
import {
  BeatTableDialogs,
} from "@/components/beat-table-dialogs";
import {
  useBeatTableState,
} from "@/components/use-beat-table-state";
import {
  useBeatTableKeyboard,
} from "@/components/beat-table-keyboard";

type BeatTableProps = {
  data: Beat[];
  showRepoColumn?: boolean;
  showAgentColumns?: boolean;
  agentInfoByBeatId?: Record<
    string,
    import("@/components/beat-columns").AgentInfo
  >;
  onSelectionChange?: (ids: string[]) => void;
  selectionVersion?: number;
  searchQuery?: string;
  onOpenBeat?: (beat: Beat) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId?: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
};

// eslint-disable-next-line max-lines-per-function
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
}: BeatTableProps) {
  const s = useBeatTableState({
    data, showRepoColumn, showAgentColumns,
    agentInfoByBeatId, onSelectionChange,
    selectionVersion, onOpenBeat, onShipBeat,
    shippingByBeatId, onAbortShipping,
  });

  const [sorting, setSorting] =
    useState<SortingState>([]);
  const [rowSelection, setRowSelection] =
    useState<RowSelectionState>({});

  useEffect(() => {
    setRowSelection({});
  }, [s.selectionVersion]);
  useEffect(() => {
    setRowSelection({});
  }, [s.activeRepo]);
  const { sortedLen, filtersKey, setPageIdx } = s;
  useEffect(() => {
    setPageIdx(() => 0);
  }, [sortedLen, filtersKey, setPageIdx]);
  useEffect(() => {
    performance.mark("beat-table:render-ready");
  }, [data.length, sortedLen]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: s.paginatedData,
    columns: s.columns,
    state: { sorting, rowSelection },
    getRowId: (row) => row.id,
    onSortingChange: (u) => {
      setSorting(u);
      s.setUserSorted(true);
    },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  useSelectionSync(table, onSelectionChange);
  useFocusEffects(table, s);
  useBeatTableKeyboard({
    focusedRowId: s.focusedRowId,
    setFocusedRowId: s.setFocusedRowId,
    table,
    tableContainerRef: s.containerRef,
    handleUpdateBeat: s.doUpdate,
    initiateClose: s.initiateClose,
    onShipBeat: s.onShipBeat,
    shippingByBeatId: s.shippingByBeatId,
    parentRollingBeatIds: s.parentRolling,
    setNotesBeat: s.setNotesBeat,
    setNotesDialogOpen: s.setNotesOpen,
    setExpandedIds: s.setExpandedIds,
  });

  return (
    <PerfProfiler id="beat-table" interactionLabel="beats:list" beatCount={data.length}>
      <div
        ref={s.containerRef}
        tabIndex={-1}
        data-testid="beat-table-shell"
        className="space-y-1 outline-none"
      >
        <BeatTableContent
          table={table}
          columns={s.columns}
          focusedRowId={s.focusedRowId}
          handleRowFocus={s.onRowFocus}
          searchQuery={searchQuery}
          searchParams={s.searchParams}
          router={s.router}
          titleRenderOpts={s.titleRenderOpts}
        />
        {s.manualPageCount > 1 && (
          <BeatTablePagination
            manualPageIndex={s.pageIdx}
            manualPageCount={s.manualPageCount}
            pageSize={s.pageSize}
            setManualPageIndex={s.setPageIdx}
            updateUrl={s.updateUrl}
          />
        )}
        <BeatTableDialogs
          notesBeat={s.notesBeat}
          notesOpen={s.notesOpen}
          setNotesOpen={s.setNotesOpen}
          handleUpdateBeat={s.doUpdate}
          cascadeOpen={s.cascadeOpen}
          setCascadeOpen={s.setCascadeOpen}
          cascadeBeat={s.cascadeBeat}
          setCascadeBeat={s.setCascadeBeat}
          cascadeDesc={s.cascadeDesc}
          setCascadeDesc={s.setCascadeDesc}
          cascadeLoading={s.cascadeLoading}
          handleCascadeClose={s.doCascade}
        />
      </div>
    </PerfProfiler>
  );
}

/* ---- Small internal hooks ---- */

function useSelectionSync(
  table: ReturnType<typeof useReactTable<Beat>>,
  onChange?: (ids: string[]) => void,
) {
  const ids = table
    .getFilteredSelectedRowModel()
    .rows.map((r) => r.original.id);
  const key = ids.join(",");
  useEffect(() => {
    onChange?.(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onChange]);
}

function useFocusEffects(
  table: ReturnType<typeof useReactTable<Beat>>,
  s: ReturnType<typeof useBeatTableState>,
) {
  const rowCount =
    table.getRowModel().rows.length;

  useEffect(() => {
    const rows = table.getRowModel().rows;
    if (rows.length > 0 && !s.focusedRowId) {
      s.setFocusedRowId(rows[0].original.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount]);

  useEffect(() => {
    const rows = table.getRowModel().rows;
    const first = rows.length > 0
      ? rows[0].original.id
      : null;
    s.setFocusedRowId(first);
    const t = setTimeout(() => {
      s.containerRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.filtersKey]);
}
