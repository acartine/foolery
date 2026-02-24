"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Filter } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type {
  AgentHistoryEntry,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { fetchMessageTypeIndex } from "@/lib/agent-message-type-api";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface InteractionItem {
  id: string;
  label: string;
  source: string;
  timestamp: string;
  entryId: string;
  sessionIndex: number;
}

export interface InteractionPickerState {
  interactions: InteractionItem[];
  selectedInteraction: string | null;
  messageTypeFilters: Set<string>;
  availableMessageTypes: string[];
  isIndexLoading: boolean;
  selectInteraction: (id: string) => void;
  toggleTypeFilter: (type: string) => void;
  clearTypeFilters: () => void;
  entryRefCallback: (id: string, node: HTMLDivElement | null) => void;
  highlightedEntryId: string | null;
  filterEntry: (entry: AgentHistoryEntry) => boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatCompactTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function promptSourceLabel(source: string): string {
  if (source === "initial") return "Initial prompt";
  if (source === "execution_follow_up") return "Execution follow-up";
  if (source === "ship_completion_follow_up") return "Ship follow-up";
  if (source === "scene_completion_follow_up") return "Scene follow-up";
  if (source === "verification_review") return "Verification";
  if (source === "auto_ask_user_response") return "Auto AskUser";
  return source.replace(/_/g, " ");
}

/* ------------------------------------------------------------------ */
/*  Hook: useInteractionPicker                                        */
/* ------------------------------------------------------------------ */

export function useInteractionPicker(
  sessions: AgentHistorySession[],
): InteractionPickerState {
  const entryRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedInteraction, setSelectedInteraction] = useState<string | null>(
    null,
  );
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(
    null,
  );
  const [messageTypeFilters, setMessageTypeFilters] = useState<Set<string>>(
    new Set(),
  );

  // Fetch message type index
  const typeIndexQuery = useQuery({
    queryKey: ["agent-message-type-index"],
    queryFn: fetchMessageTypeIndex,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const availableMessageTypes = useMemo(() => {
    if (!typeIndexQuery.data?.ok || !typeIndexQuery.data.data) return [];
    return typeIndexQuery.data.data.entries.map((e) => e.type);
  }, [typeIndexQuery.data]);

  // Build interaction list from sessions
  const interactions = useMemo<InteractionItem[]>(() => {
    const items: InteractionItem[] = [];
    for (const [sessionIdx, session] of sessions.entries()) {
      for (const entry of session.entries) {
        if (entry.kind !== "prompt") continue;
        const source = entry.promptSource || "unknown";
        items.push({
          id: entry.id,
          label: promptSourceLabel(source),
          source,
          timestamp: entry.ts,
          entryId: entry.id,
          sessionIndex: sessionIdx,
        });
      }
    }
    items.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    return items;
  }, [sessions]);

  const entryRefCallback = useCallback(
    (id: string, node: HTMLDivElement | null) => {
      if (node) entryRefs.current.set(id, node);
      else entryRefs.current.delete(id);
    },
    [],
  );

  const selectInteraction = useCallback((id: string) => {
    setSelectedInteraction(id);
    const node = entryRefs.current.get(id);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedEntryId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => {
      setHighlightedEntryId((curr) => (curr === id ? null : curr));
    }, 3000);
  }, []);

  const toggleTypeFilter = useCallback((type: string) => {
    setMessageTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const clearTypeFilters = useCallback(() => {
    setMessageTypeFilters(new Set());
  }, []);

  // Filter function for entries
  const filterEntry = useCallback(
    (entry: AgentHistoryEntry): boolean => {
      if (messageTypeFilters.size === 0) return true;
      if (entry.kind !== "response") return true; // always show non-response
      if (!entry.raw) return false;
      try {
        const parsed = JSON.parse(entry.raw.trim());
        return (
          typeof parsed.type === "string" &&
          messageTypeFilters.has(parsed.type)
        );
      } catch {
        return false;
      }
    },
    [messageTypeFilters],
  );

  // Reset on session change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset picker state when session data changes; mirrors agent-history-view pattern.
    setSelectedInteraction(null);
    setHighlightedEntryId(null);
  }, [sessions]);

  return {
    interactions,
    selectedInteraction,
    messageTypeFilters,
    availableMessageTypes,
    isIndexLoading: typeIndexQuery.isLoading,
    selectInteraction,
    toggleTypeFilter,
    clearTypeFilters,
    entryRefCallback,
    highlightedEntryId,
    filterEntry,
  };
}

/* ------------------------------------------------------------------ */
/*  Component: InteractionPicker                                      */
/* ------------------------------------------------------------------ */

export function InteractionPicker({
  picker,
}: {
  picker: InteractionPickerState;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const selectedLabel = picker.selectedInteraction
    ? (picker.interactions.find((i) => i.id === picker.selectedInteraction)
        ?.label ?? "Select interaction")
    : "Select interaction";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-2.5 py-1 text-[10px]">
      {/* Interaction dropdown */}
      <InteractionDropdown
        dropdownRef={dropdownRef}
        dropdownOpen={dropdownOpen}
        setDropdownOpen={setDropdownOpen}
        selectedLabel={selectedLabel}
        picker={picker}
      />

      <span className="text-slate-600">|</span>

      {/* Type filter chips */}
      <TypeFilterChips picker={picker} />

      {/* Interaction count */}
      <span className="ml-auto text-[10px] text-slate-400">
        {picker.interactions.length} interaction
        {picker.interactions.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function InteractionDropdown({
  dropdownRef,
  dropdownOpen,
  setDropdownOpen,
  selectedLabel,
  picker,
}: {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  selectedLabel: string;
  picker: InteractionPickerState;
}) {
  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="inline-flex items-center gap-1 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700"
      >
        <span>{selectedLabel}</span>
        <ChevronDown className="size-3" />
      </button>

      {dropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded border border-slate-600 bg-slate-800 shadow-lg">
          {picker.interactions.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-slate-400">
              No interactions found
            </div>
          ) : (
            picker.interactions.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  picker.selectInteraction(item.entryId);
                  setDropdownOpen(false);
                }}
                className={`block w-full px-2 py-1.5 text-left text-[10px] hover:bg-slate-700 ${
                  picker.selectedInteraction === item.id
                    ? "bg-slate-700 text-slate-100"
                    : "text-slate-300"
                }`}
              >
                <span className="font-medium">{item.label}</span>
                <span className="ml-1 text-slate-400">
                  — {formatCompactTime(item.timestamp)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TypeFilterChips({
  picker,
}: {
  picker: InteractionPickerState;
}) {
  return (
    <div className="flex items-center gap-1">
      <Filter className="size-3 text-slate-400" />
      {picker.isIndexLoading ? (
        <span className="text-[9px] text-slate-500">Loading types…</span>
      ) : picker.availableMessageTypes.length === 0 ? (
        <span className="text-[9px] text-slate-500">No type index</span>
      ) : (
        <>
          {picker.availableMessageTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => picker.toggleTypeFilter(type)}
              className={`rounded px-1.5 py-0.5 text-[9px] ${
                picker.messageTypeFilters.has(type)
                  ? "bg-cyan-800 text-cyan-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {type}
            </button>
          ))}
          {picker.messageTypeFilters.size > 0 && (
            <button
              type="button"
              onClick={picker.clearTypeFilters}
              className="ml-1 text-[9px] text-slate-500 hover:text-slate-300"
            >
              clear
            </button>
          )}
        </>
      )}
    </div>
  );
}
