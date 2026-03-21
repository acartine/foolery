"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Filter } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type {
  AgentHistoryEntry,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { fetchMessageTypeIndex } from "@/lib/agent-message-type-api";
import { Switch } from "@/components/ui/switch";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type WorkflowStepFilterId =
  | "planning"
  | "plan_review"
  | "implementation"
  | "implementation_review"
  | "shipment"
  | "shipment_review";

interface WorkflowStepFilterOption {
  id: WorkflowStepFilterId;
  label: string;
  states: readonly [string, string];
}

const WORKFLOW_STEP_FILTERS: readonly WorkflowStepFilterOption[] = [
  {
    id: "planning",
    label: "Planning",
    states: ["ready_for_planning", "planning"],
  },
  {
    id: "plan_review",
    label: "Plan Review",
    states: ["ready_for_plan_review", "plan_review"],
  },
  {
    id: "implementation",
    label: "Implementation",
    states: ["ready_for_implementation", "implementation"],
  },
  {
    id: "implementation_review",
    label: "Implementation Review",
    states: ["ready_for_implementation_review", "implementation_review"],
  },
  {
    id: "shipment",
    label: "Shipment",
    states: ["ready_for_shipment", "shipment"],
  },
  {
    id: "shipment_review",
    label: "Shipment Review",
    states: ["ready_for_shipment_review", "shipment_review"],
  },
];

const WORKFLOW_FILTER_BY_ID = new Map<
  WorkflowStepFilterId,
  WorkflowStepFilterOption
>(WORKFLOW_STEP_FILTERS.map((item) => [item.id, item]));

const WORKFLOW_STATES = Array.from(
  new Set(
    WORKFLOW_STEP_FILTERS.flatMap((item) => [item.states[0], item.states[1]]),
  ),
);
const WORKFLOW_FILTER_BY_STATE = new Map<string, WorkflowStepFilterOption>(
  WORKFLOW_STEP_FILTERS.flatMap((item) => [
    [item.states[0], item] as const,
    [item.states[1], item] as const,
  ]),
);

export interface InteractionItem {
  id: string;
  label: string;
  source: string;
  timestamp: string;
  entryId: string;
  sessionIndex: number;
  promptNumber: number;
  workflowState?: string;
  workflowStepLabel?: string;
}

export interface InteractionPickerState {
  interactions: InteractionItem[];
  selectedInteraction: string | null;
  messageTypeFilters: Set<string>;
  workflowStepFilters: Set<WorkflowStepFilterId>;
  thinkingDetailVisible: boolean;
  availableMessageTypes: string[];
  availableWorkflowStepFilters: readonly WorkflowStepFilterOption[];
  isIndexLoading: boolean;
  selectInteraction: (id: string) => void;
  toggleTypeFilter: (type: string) => void;
  toggleWorkflowStepFilter: (stepId: WorkflowStepFilterId) => void;
  toggleThinkingDetail: () => void;
  clearFilters: () => void;
  entryRefCallback: (id: string, node: HTMLDivElement | null) => void;
  highlightedEntryId: string | null;
  filterEntry: (entry: AgentHistoryEntry, session: AgentHistorySession) => boolean;
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
  if (source === "auto_ask_user_response") return "Auto AskUser";
  return source.replace(/_/g, " ");
}

function promptStateMeta(
  workflowState?: string,
  workflowStepLabel?: string,
): string {
  if (!workflowState) return "State unknown";
  if (!workflowStepLabel) return workflowState;
  return `${workflowStepLabel} · ${workflowState}`;
}

function collectWorkflowStatesFromText(
  text: string,
  stateSet: Set<string>,
): void {
  for (const state of WORKFLOW_STATES) {
    if (text.includes(state)) {
      stateSet.add(state);
    }
  }
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
  const [workflowStepFilters, setWorkflowStepFilters] = useState<
    Set<WorkflowStepFilterId>
  >(new Set());
  const [thinkingDetailVisible, setThinkingDetailVisible] = useState(false);

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

  const availableWorkflowStepFilters = useMemo(
    () => WORKFLOW_STEP_FILTERS,
    [],
  );

  // Build interaction list from sessions
  const interactions = useMemo<InteractionItem[]>(() => {
    const items: InteractionItem[] = [];
    for (const [sessionIdx, session] of sessions.entries()) {
      let promptFallbackNumber = 0;
      for (const entry of session.entries) {
        if (entry.kind !== "prompt") continue;
        promptFallbackNumber += 1;
        const source = entry.promptSource || "unknown";
        const promptNumber = entry.promptNumber ?? promptFallbackNumber;
        const workflowState = entry.workflowState;
        const workflowStepLabel = workflowState
          ? WORKFLOW_FILTER_BY_STATE.get(workflowState)?.label
          : undefined;
        items.push({
          id: entry.id,
          label: `Prompt #${promptNumber} · ${promptSourceLabel(source)}`,
          source,
          timestamp: entry.ts,
          entryId: entry.id,
          sessionIndex: sessionIdx,
          promptNumber,
          ...(workflowState ? { workflowState } : {}),
          ...(workflowStepLabel ? { workflowStepLabel } : {}),
        });
      }
    }
    items.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    return items;
  }, [sessions]);

  const sessionWorkflowStates = useMemo(() => {
    const bySession = new Map<string, Set<string>>();

    for (const session of sessions) {
      const states = new Set<string>(session.workflowStates ?? []);
      if (states.size === 0) {
        for (const entry of session.entries) {
          if (entry.kind === "prompt" && entry.prompt) {
            collectWorkflowStatesFromText(entry.prompt, states);
          } else if (entry.kind === "response" && entry.raw) {
            collectWorkflowStatesFromText(entry.raw, states);
          }
        }
      }
      bySession.set(session.sessionId, states);
    }

    return bySession;
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

  const toggleWorkflowStepFilter = useCallback((stepId: WorkflowStepFilterId) => {
    setWorkflowStepFilters((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setMessageTypeFilters(new Set());
    setWorkflowStepFilters(new Set());
  }, []);

  const toggleThinkingDetail = useCallback(() => {
    setThinkingDetailVisible((prev) => !prev);
  }, []);

  const sessionMatchesWorkflowFilter = useCallback(
    (session: AgentHistorySession): boolean => {
      if (workflowStepFilters.size === 0) return true;
      const sessionStates = sessionWorkflowStates.get(session.sessionId);
      if (!sessionStates || sessionStates.size === 0) return false;

      for (const stepId of workflowStepFilters) {
        const stepDef = WORKFLOW_FILTER_BY_ID.get(stepId);
        if (!stepDef) continue;
        if (
          sessionStates.has(stepDef.states[0]) ||
          sessionStates.has(stepDef.states[1])
        ) {
          return true;
        }
      }
      return false;
    },
    [workflowStepFilters, sessionWorkflowStates],
  );

  // Filter function for entries
  const filterEntry = useCallback(
    (entry: AgentHistoryEntry, session: AgentHistorySession): boolean => {
      if (!sessionMatchesWorkflowFilter(session)) {
        return false;
      }

      if (entry.kind !== "response") return true; // always show non-response
      if (!entry.raw) return false;

      try {
        const parsed = JSON.parse(entry.raw.trim());
        const type = typeof parsed.type === "string" ? parsed.type : "";

        // Explicit message type filters take precedence
        if (messageTypeFilters.size > 0) {
          return messageTypeFilters.has(type);
        }

        // When thinking detail is hidden, suppress tool results and system events
        if (!thinkingDetailVisible && (type === "user" || type === "system")) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
    [messageTypeFilters, thinkingDetailVisible, sessionMatchesWorkflowFilter],
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
    workflowStepFilters,
    thinkingDetailVisible,
    availableMessageTypes,
    availableWorkflowStepFilters,
    isIndexLoading: typeIndexQuery.isLoading,
    selectInteraction,
    toggleTypeFilter,
    toggleWorkflowStepFilter,
    toggleThinkingDetail,
    clearFilters,
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
  const [interactionDropdownOpen, setInteractionDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const interactionDropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!interactionDropdownOpen && !filterDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        interactionDropdownRef.current &&
        !interactionDropdownRef.current.contains(target)
      ) {
        setInteractionDropdownOpen(false);
      }
      if (
        filterDropdownRef.current &&
        !filterDropdownRef.current.contains(target)
      ) {
        setFilterDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [interactionDropdownOpen, filterDropdownOpen]);

  const selectedLabel = picker.selectedInteraction
    ? (picker.interactions.find((i) => i.id === picker.selectedInteraction)
        ?.label ?? "Select interaction")
    : "Select interaction";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-600 bg-slate-950/50 px-2.5 py-1 text-[13px]">
      <InteractionDropdown
        dropdownRef={interactionDropdownRef}
        dropdownOpen={interactionDropdownOpen}
        setDropdownOpen={setInteractionDropdownOpen}
        selectedLabel={selectedLabel}
        picker={picker}
      />

      <span className="text-slate-400">|</span>

      <FilterDropdown
        dropdownRef={filterDropdownRef}
        dropdownOpen={filterDropdownOpen}
        setDropdownOpen={setFilterDropdownOpen}
        picker={picker}
      />

      <span className="text-slate-400">|</span>

      <label className="inline-flex items-center gap-1.5">
        <span className="text-[13px] text-slate-200">Detail</span>
        <Switch
          checked={picker.thinkingDetailVisible}
          onCheckedChange={picker.toggleThinkingDetail}
          className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-slate-600"
        />
      </label>

      <span className="ml-auto text-[13px] text-slate-200">
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
        className="inline-flex items-center gap-1 rounded border border-slate-500 bg-slate-800/95 px-2 py-0.5 text-[13px] text-slate-100 hover:bg-slate-700/90"
      >
        <span>{selectedLabel}</span>
        <ChevronDown className="size-4" />
      </button>

      {dropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded border border-slate-500 bg-slate-900/95 shadow-lg">
          {picker.interactions.length === 0 ? (
            <div className="px-2 py-1.5 text-[13px] text-slate-200">
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
                className={`block w-full px-2 py-1.5 text-left text-[13px] hover:bg-slate-700/90 ${
                  picker.selectedInteraction === item.id
                    ? "bg-slate-700/90 text-slate-50"
                    : "text-slate-200"
                }`}
              >
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11px] text-slate-200">
                  {promptStateMeta(item.workflowState, item.workflowStepLabel)}
                  {" · "}
                  {formatCompactTime(item.timestamp)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FilterDropdown({
  dropdownRef,
  dropdownOpen,
  setDropdownOpen,
  picker,
}: {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  picker: InteractionPickerState;
}) {
  const selectedCount =
    picker.messageTypeFilters.size + picker.workflowStepFilters.size;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="inline-flex items-center gap-1 rounded border border-slate-500 bg-slate-800/95 px-2 py-0.5 text-[13px] text-slate-100 hover:bg-slate-700/90"
      >
        <Filter className="size-4" />
        <span>Filters</span>
        {selectedCount > 0 ? (
          <span className="rounded bg-cyan-800/80 px-1 text-[12px] text-cyan-50">
            {selectedCount}
          </span>
        ) : null}
        <ChevronDown className="size-4" />
      </button>

      {dropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded border border-slate-500 bg-slate-900/95 shadow-lg">
          <div className="max-h-72 space-y-2 overflow-y-auto p-2">
            <section>
              <p className="px-1 text-[12px] uppercase tracking-wide text-slate-300">
                Agent Message Types
              </p>
              <div className="mt-1 space-y-0.5">
                {picker.isIndexLoading ? (
                  <p className="px-1 py-1 text-[12px] text-slate-300">
                    Loading types…
                  </p>
                ) : picker.availableMessageTypes.length === 0 ? (
                  <p className="px-1 py-1 text-[12px] text-slate-300">
                    No type index
                  </p>
                ) : (
                  picker.availableMessageTypes.map((type) => (
                    <FilterOptionRow
                      key={type}
                      selected={picker.messageTypeFilters.has(type)}
                      label={type}
                      onToggle={() => picker.toggleTypeFilter(type)}
                    />
                  ))
                )}
              </div>
            </section>

            <section>
              <p className="px-1 text-[12px] uppercase tracking-wide text-slate-300">
                Workflow Steps (queue/action)
              </p>
              <div className="mt-1 space-y-0.5">
                {picker.availableWorkflowStepFilters.map((step) => (
                  <FilterOptionRow
                    key={step.id}
                    selected={picker.workflowStepFilters.has(step.id)}
                    label={step.label}
                    description={`${step.states[0]} / ${step.states[1]}`}
                    onToggle={() => picker.toggleWorkflowStepFilter(step.id)}
                  />
                ))}
              </div>
            </section>
          </div>
          <div className="flex items-center justify-between border-t border-slate-600 bg-slate-950/60 px-2 py-1">
            <span className="text-[12px] text-slate-300">
              {selectedCount === 0
                ? "No filters selected"
                : `${selectedCount} active filter${selectedCount === 1 ? "" : "s"}`}
            </span>
            {selectedCount > 0 ? (
              <button
                type="button"
                onClick={picker.clearFilters}
                className="text-[12px] text-slate-200 hover:text-white"
              >
                Clear all
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterOptionRow({
  selected,
  label,
  description,
  onToggle,
}: {
  selected: boolean;
  label: string;
  description?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-slate-700/75"
    >
      <span
        className={`mt-[1px] inline-flex size-4 shrink-0 items-center justify-center rounded border ${
          selected
            ? "border-cyan-400 bg-cyan-700 text-cyan-100"
            : "border-slate-500 text-transparent"
        }`}
      >
        <Check className="size-2.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-slate-100">{label}</span>
        {description ? (
          <span className="block truncate text-[12px] text-slate-300">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
