"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type {
  AgentHistoryEntry,
  AgentHistorySession,
} from "@/lib/agent-history-types";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type MessageFilter = "all" | "prompt" | "response";

export interface IndexedEntry {
  entry: AgentHistoryEntry;
  sessionIndex: number;
  globalIndex: number;
  typeIndex: number;
}

export interface NavigableEntries {
  entries: IndexedEntry[];
  promptCount: number;
  responseCount: number;
}

/* ------------------------------------------------------------------ */
/*  Hook: useMessageNavigation                                        */
/* ------------------------------------------------------------------ */

export interface MessageNavigationState {
  messageFilter: MessageFilter;
  setMessageFilter: (f: MessageFilter) => void;
  currentNavIndex: number;
  highlightedEntryId: string | null;
  navigableEntries: NavigableEntries;
  filteredEntries: IndexedEntry[];
  navigateTo: (index: number) => void;
  navigateNext: () => void;
  navigatePrev: () => void;
  entryRefCallback: (id: string, node: HTMLDivElement | null) => void;
  jumpInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useMessageNavigation(
  sessions: AgentHistorySession[],
): MessageNavigationState {
  const entryRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpInputRef = useRef<HTMLInputElement | null>(null);

  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");
  const [currentNavIndex, setCurrentNavIndex] = useState<number>(-1);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(
    null,
  );

  const navigableEntries = useMemo<NavigableEntries>(() => {
    const result: IndexedEntry[] = [];
    let promptCount = 0;
    let responseCount = 0;
    for (const [sessionIdx, session] of sessions.entries()) {
      for (const entry of session.entries) {
        if (entry.kind === "prompt") {
          result.push({
            entry,
            sessionIndex: sessionIdx,
            globalIndex: result.length,
            typeIndex: promptCount,
          });
          promptCount++;
        } else if (entry.kind === "response") {
          result.push({
            entry,
            sessionIndex: sessionIdx,
            globalIndex: result.length,
            typeIndex: responseCount,
          });
          responseCount++;
        }
      }
    }
    return { entries: result, promptCount, responseCount };
  }, [sessions]);

  const filteredEntries = useMemo<IndexedEntry[]>(() => {
    if (messageFilter === "all") return navigableEntries.entries;
    return navigableEntries.entries.filter(
      (e) => e.entry.kind === messageFilter,
    );
  }, [navigableEntries, messageFilter]);

  /* Reset navigation state when sessions change */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset nav position when session data changes; mirrors agent-history-view pattern.
    setCurrentNavIndex(-1);
    setHighlightedEntryId(null);
  }, [sessions]);

  /* Reset index when switching filters */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset nav position when filter changes; mirrors retakes-view pattern.
    setCurrentNavIndex(-1);
  }, [messageFilter]);

  const entryRefCallback = useCallback(
    (id: string, node: HTMLDivElement | null) => {
      if (node) {
        entryRefs.current.set(id, node);
      } else {
        entryRefs.current.delete(id);
      }
    },
    [],
  );

  const navigateTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= filteredEntries.length) return;
      setCurrentNavIndex(index);
      const indexed = filteredEntries[index];
      const node = entryRefs.current.get(indexed.entry.id);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      const entryId = indexed.entry.id;
      setHighlightedEntryId(entryId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => {
        setHighlightedEntryId((current) =>
          current === entryId ? null : current,
        );
      }, 3000);
    },
    [filteredEntries],
  );

  const navigateNext = useCallback(() => {
    const next =
      currentNavIndex < filteredEntries.length - 1 ? currentNavIndex + 1 : 0;
    navigateTo(next);
  }, [currentNavIndex, filteredEntries.length, navigateTo]);

  const navigatePrev = useCallback(() => {
    const prev =
      currentNavIndex > 0 ? currentNavIndex - 1 : filteredEntries.length - 1;
    navigateTo(prev);
  }, [currentNavIndex, filteredEntries.length, navigateTo]);

  return {
    messageFilter,
    setMessageFilter,
    currentNavIndex,
    highlightedEntryId,
    navigableEntries,
    filteredEntries,
    navigateTo,
    navigateNext,
    navigatePrev,
    entryRefCallback,
    jumpInputRef,
  };
}

/* ------------------------------------------------------------------ */
/*  Component: MessageNavigator                                       */
/* ------------------------------------------------------------------ */

function filterLabel(filter: MessageFilter): string {
  if (filter === "prompt") return "App";
  if (filter === "response") return "Agent";
  return "Message";
}

export function MessageNavigator({
  nav,
}: {
  nav: MessageNavigationState;
}) {
  const {
    messageFilter,
    setMessageFilter,
    currentNavIndex,
    navigableEntries,
    filteredEntries,
    navigateTo,
    navigateNext,
    navigatePrev,
    jumpInputRef,
  } = nav;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-2.5 py-1 text-[10px]">
      {/* Filter buttons */}
      <button
        type="button"
        onClick={() => setMessageFilter("all")}
        className={`rounded px-1.5 py-0.5 ${
          messageFilter === "all"
            ? "bg-slate-600 text-slate-100"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >
        All ({navigableEntries.entries.length})
      </button>
      <button
        type="button"
        onClick={() => setMessageFilter("prompt")}
        className={`rounded px-1.5 py-0.5 ${
          messageFilter === "prompt"
            ? "bg-sky-800 text-sky-100"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >
        App ({navigableEntries.promptCount})
      </button>
      <button
        type="button"
        onClick={() => setMessageFilter("response")}
        className={`rounded px-1.5 py-0.5 ${
          messageFilter === "response"
            ? "bg-slate-700 text-slate-100"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >
        Agent ({navigableEntries.responseCount})
      </button>

      <span className="text-slate-600">|</span>

      {/* Navigation controls */}
      <button
        type="button"
        onClick={navigatePrev}
        disabled={filteredEntries.length === 0}
        className="rounded p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30"
        aria-label="Previous message"
      >
        <ArrowUp className="size-3" />
      </button>
      <span className="min-w-[6ch] text-center text-slate-300">
        {currentNavIndex >= 0
          ? `${filterLabel(messageFilter)} ${currentNavIndex + 1} / ${filteredEntries.length}`
          : `-- / ${filteredEntries.length}`}
      </span>
      <button
        type="button"
        onClick={navigateNext}
        disabled={filteredEntries.length === 0}
        className="rounded p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30"
        aria-label="Next message"
      >
        <ArrowDown className="size-3" />
      </button>

      <span className="text-slate-600">|</span>

      {/* Jump input */}
      <label className="text-slate-400" htmlFor="msg-nav-jump">
        Jump:
      </label>
      <input
        ref={jumpInputRef}
        id="msg-nav-jump"
        type="number"
        min={1}
        max={filteredEntries.length}
        placeholder="#"
        className="w-12 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-center text-[10px] text-slate-200 placeholder:text-slate-500"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const input = e.target as HTMLInputElement;
            const value = parseInt(input.value, 10);
            if (value >= 1 && value <= filteredEntries.length) {
              navigateTo(value - 1);
              input.value = "";
            }
          }
        }}
      />
    </div>
  );
}
