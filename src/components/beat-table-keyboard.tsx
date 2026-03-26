import { useEffect } from "react";
import { useReactTable } from "@tanstack/react-table";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { persistExpandedIds } from "@/components/beat-table-expand";

type KeyboardHookParams = {
  focusedRowId: string | null;
  setFocusedRowId: (id: string | null) => void;
  table: ReturnType<typeof useReactTable<Beat>>;
  tableContainerRef: React.RefObject<
    HTMLDivElement | null
  >;
  handleUpdateBeat: (args: {
    id: string;
    fields: UpdateBeatInput;
    repoPath?: string;
  }) => void;
  initiateClose: (id: string) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId: Record<string, string>;
  parentRollingBeatIds: Set<string>;
  setNotesBeat: (beat: Beat | null) => void;
  setNotesDialogOpen: (open: boolean) => void;
  setExpandedIds: (
    fn: (prev: Set<string>) => Set<string>,
  ) => void;
};

/** Keyboard handler hook for BeatTable. */
export function useBeatTableKeyboard(
  params: KeyboardHookParams,
) {
  const {
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
    setExpandedIds,
  } = params;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (
        tag === "TEXTAREA" ||
        tag === "INPUT" ||
        tag === "SELECT"
      ) {
        return;
      }

      const container = tableContainerRef.current;
      if (container && container.offsetParent === null) {
        return;
      }

      if (handleLabelHotkey(e)) return;
      if (handleNotesHotkey(
        e,
        table,
        focusedRowId,
        setNotesBeat,
        setNotesDialogOpen,
      )) return;

      const rows = table.getRowModel().rows;
      if (rows.length === 0) return;
      const idx = rows.findIndex(
        (r) => r.original.id === focusedRowId,
      );

      if (handleNavigationKeys(
        e, rows, idx, setFocusedRowId,
      )) return;
      if (handleSpaceSelect(
        e, rows, idx, setFocusedRowId,
      )) return;
      handleActionKeys(e, rows, idx, {
        setFocusedRowId,
        handleUpdateBeat,
        initiateClose,
        onShipBeat,
        shippingByBeatId,
        parentRollingBeatIds,
        setExpandedIds,
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    focusedRowId,
    table,
    handleUpdateBeat,
    initiateClose,
    onShipBeat,
    shippingByBeatId,
    parentRollingBeatIds,
    tableContainerRef,
    setNotesBeat,
    setNotesDialogOpen,
    setExpandedIds,
    setFocusedRowId,
  ]);
}

/* --- Keyboard helper functions -------------- */

function handleLabelHotkey(
  e: KeyboardEvent,
): boolean {
  if (e.key === "L" && e.shiftKey) {
    e.preventDefault();
    const focused = document.querySelector(
      "tr.bg-muted\\/50",
    );
    if (focused) {
      const btn = focused.querySelector(
        "[data-add-label]",
      ) as HTMLButtonElement;
      if (btn) btn.click();
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
  if (
    e.key === "O" &&
    e.shiftKey &&
    !e.metaKey &&
    !e.ctrlKey
  ) {
    e.preventDefault();
    const rows = table.getRowModel().rows;
    const idx = rows.findIndex(
      (r) => r.original.id === focusedRowId,
    );
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
    const next =
      currentIndex < rows.length - 1
        ? currentIndex + 1
        : currentIndex;
    if (next !== currentIndex) {
      e.preventDefault();
      setFocusedRowId(rows[next].original.id);
    }
    return true;
  }
  if (e.key === "ArrowUp") {
    const next =
      currentIndex > 0 ? currentIndex - 1 : 0;
    if (next !== currentIndex) {
      e.preventDefault();
      setFocusedRowId(rows[next].original.id);
    }
    return true;
  }
  return false;
}

type SelectableRow = {
  original: Beat;
  toggleSelected: (v: boolean) => void;
  getIsSelected: () => boolean;
};

function handleSpaceSelect(
  e: KeyboardEvent,
  rows: SelectableRow[],
  currentIndex: number,
  setFocusedRowId: (id: string | null) => void,
): boolean {
  if (e.key === " ") {
    e.preventDefault();
    if (currentIndex < 0) return true;
    rows[currentIndex].toggleSelected(
      !rows[currentIndex].getIsSelected(),
    );
    if (currentIndex < rows.length - 1) {
      setFocusedRowId(
        rows[currentIndex + 1].original.id,
      );
    }
    return true;
  }
  return false;
}

type ActionCtx = {
  setFocusedRowId: (id: string | null) => void;
  handleUpdateBeat: (args: {
    id: string;
    fields: UpdateBeatInput;
    repoPath?: string;
  }) => void;
  initiateClose: (id: string) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId: Record<string, string>;
  parentRollingBeatIds: Set<string>;
  setExpandedIds: (
    fn: (prev: Set<string>) => Set<string>,
  ) => void;
};

function handleActionKeys(
  e: KeyboardEvent,
  rows: { original: Beat }[],
  currentIndex: number,
  ctx: ActionCtx,
): void {
  if (e.key === "S" && e.shiftKey) {
    handleShipKey(e, rows, currentIndex, ctx);
  } else if (
    e.key === "C" &&
    e.shiftKey &&
    !e.metaKey &&
    !e.ctrlKey
  ) {
    handleCloseKey(e, rows, currentIndex, ctx);
  } else if (e.key === "<" && e.shiftKey) {
    handleCollapseKey(e, rows, currentIndex, ctx);
  } else if (e.key === ">" && e.shiftKey) {
    handleExpandKey(e, rows, currentIndex, ctx);
  }
}

function handleShipKey(
  e: KeyboardEvent,
  rows: { original: Beat }[],
  idx: number,
  ctx: ActionCtx,
): void {
  if (!ctx.onShipBeat || idx < 0) return;
  const beat = rows[idx].original;
  if (
    beat.state === "shipped" ||
    beat.state === "closed" ||
    beat.type === "gate"
  ) return;
  const inherited =
    ctx.parentRollingBeatIds.has(beat.id) ||
    Boolean(
      beat.parent && ctx.shippingByBeatId[beat.parent],
    );
  if (inherited) return;
  e.preventDefault();
  ctx.onShipBeat(beat);
}

function handleCloseKey(
  e: KeyboardEvent,
  rows: { original: Beat }[],
  idx: number,
  ctx: ActionCtx,
): void {
  if (idx < 0) return;
  const beat = rows[idx].original;
  if (
    beat.state === "shipped" ||
    beat.state === "closed"
  ) return;
  e.preventDefault();
  ctx.initiateClose(beat.id);
  const nextIdx =
    idx < rows.length - 1
      ? idx + 1
      : Math.max(0, idx - 1);
  if (
    rows[nextIdx] &&
    rows[nextIdx].original.id !== beat.id
  ) {
    ctx.setFocusedRowId(rows[nextIdx].original.id);
  }
}

function handleCollapseKey(
  e: KeyboardEvent,
  rows: { original: Beat }[],
  idx: number,
  ctx: ActionCtx,
): void {
  if (idx < 0) return;
  const hb = rows[idx].original as unknown as {
    _hasChildren?: boolean;
    id: string;
  };
  if (!hb._hasChildren) return;
  e.preventDefault();
  ctx.setExpandedIds((prev) => {
    const next = new Set(prev);
    next.delete(rows[idx].original.id);
    persistExpandedIds(next);
    return next;
  });
}

function handleExpandKey(
  e: KeyboardEvent,
  rows: { original: Beat }[],
  idx: number,
  ctx: ActionCtx,
): void {
  if (idx < 0) return;
  const hb = rows[idx].original as unknown as {
    _hasChildren?: boolean;
    id: string;
  };
  if (!hb._hasChildren) return;
  e.preventDefault();
  ctx.setExpandedIds((prev) => {
    const next = new Set(prev);
    next.add(rows[idx].original.id);
    persistExpandedIds(next);
    return next;
  });
}
