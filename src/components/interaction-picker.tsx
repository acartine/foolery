"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AgentHistoryEntry,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { fetchMessageTypeIndex } from "@/lib/agent-message-type-api";
import { shouldShowHistoryResponseType } from "@/lib/history-response-visibility";
import type { WorkflowStepFilterId, WorkflowStepFilterOption } from "@/components/interaction-picker-constants";
import {
  WORKFLOW_STEP_FILTERS,
  WORKFLOW_FILTER_BY_ID,
  WORKFLOW_STATES,
  WORKFLOW_FILTER_BY_STATE,
} from "@/components/interaction-picker-constants";

export interface InteractionItem {
  id: string;
  label: string;
  source: string;
  timestamp: string;
  entryId: string;
  sessionIndex: number;
  promptNumber: number;
  conversationNumber: number;
  sessionId: string;
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
  toggleWorkflowStepFilter: (
    stepId: WorkflowStepFilterId,
  ) => void;
  toggleThinkingDetail: () => void;
  clearFilters: () => void;
  entryRefCallback: (
    id: string,
    node: HTMLDivElement | null,
  ) => void;
  highlightedEntryId: string | null;
  filterEntry: (
    entry: AgentHistoryEntry,
    session: AgentHistorySession,
  ) => boolean;
}

/* --------------------------------------------------------- */
/*  Helpers                                                  */
/* --------------------------------------------------------- */

function promptSourceLabel(
  source: string,
): string {
  if (source === "initial")
    return "Initial prompt";
  if (source === "execution_follow_up")
    return "Execution follow-up";
  if (source === "ship_completion_follow_up")
    return "Ship follow-up";
  if (source === "scene_completion_follow_up")
    return "Scene follow-up";
  if (source === "auto_ask_user_response")
    return "Auto AskUser";
  return source.replace(/_/g, " ");
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

/* --------------------------------------------------------- */
/*  Hook: useInteractionPicker                               */
/* --------------------------------------------------------- */

export function useInteractionPicker(
  sessions: AgentHistorySession[],
): InteractionPickerState {
  const entryRefsRef = useRef<
    Map<string, HTMLDivElement>
  >(new Map());
  const highlightTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const [selectedInteraction, setSelected] =
    useState<string | null>(null);
  const [highlightedEntryId, setHighlighted] =
    useState<string | null>(null);
  const [messageTypeFilters, setMsgFilters] =
    useState<Set<string>>(new Set());
  const [workflowStepFilters, setStepFilters] =
    useState<Set<WorkflowStepFilterId>>(
      new Set(),
    );
  const [thinkingDetailVisible, setThinkVis] =
    useState(false);

  const typeIndexQuery = useQuery({
    queryKey: ["agent-message-type-index"],
    queryFn: fetchMessageTypeIndex,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const availableMessageTypes = useMemo(() => {
    if (
      !typeIndexQuery.data?.ok ||
      !typeIndexQuery.data.data
    )
      return [];
    return typeIndexQuery.data.data.entries.map(
      (e) => e.type,
    );
  }, [typeIndexQuery.data]);

  const interactions = useBuildInteractions(
    sessions,
  );

  const sessionWorkflowStates =
    useBuildSessionWorkflowStates(sessions);

  const callbacks = usePickerCallbacks(
    entryRefsRef,
    highlightTimerRef,
    setSelected,
    setHighlighted,
    setMsgFilters,
    setStepFilters,
    setThinkVis,
  );

  const filterEntry = useFilterEntry(
    messageTypeFilters,
    thinkingDetailVisible,
    workflowStepFilters,
    sessionWorkflowStates,
  );

  // Reset on session change
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    // Reset picker state on session change
    setSelected(null);
    setHighlighted(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [sessions]);

  return {
    interactions,
    selectedInteraction,
    messageTypeFilters,
    workflowStepFilters,
    thinkingDetailVisible,
    availableMessageTypes,
    availableWorkflowStepFilters:
      WORKFLOW_STEP_FILTERS,
    isIndexLoading: typeIndexQuery.isLoading,
    ...callbacks,
    highlightedEntryId,
    filterEntry,
  };
}

/* ---- Sub-hooks extracted from the picker ---- */

function useBuildInteractions(
  sessions: AgentHistorySession[],
): InteractionItem[] {
  return useMemo<InteractionItem[]>(() => {
    const items: InteractionItem[] = [];
    for (const [
      sessionIdx,
      session,
    ] of sessions.entries()) {
      let promptFallbackNumber = 0;
      for (const entry of session.entries) {
        if (entry.kind !== "prompt") continue;
        promptFallbackNumber += 1;
        const source =
          entry.promptSource || "unknown";
        const promptNumber =
          entry.promptNumber ??
          promptFallbackNumber;
        const workflowState =
          entry.workflowState;
        const workflowStepLabel = workflowState
          ? WORKFLOW_FILTER_BY_STATE.get(
              workflowState,
            )?.label
          : undefined;
        items.push({
          id: entry.id,
          label: `Prompt #${promptNumber} · ${promptSourceLabel(source)}`,
          source,
          timestamp: entry.ts,
          entryId: entry.id,
          sessionIndex: sessionIdx,
          promptNumber,
          conversationNumber: sessionIdx + 1,
          sessionId: session.sessionId,
          ...(workflowState
            ? { workflowState }
            : {}),
          ...(workflowStepLabel
            ? { workflowStepLabel }
            : {}),
        });
      }
    }
    items.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime(),
    );
    return items;
  }, [sessions]);
}

function useBuildSessionWorkflowStates(
  sessions: AgentHistorySession[],
): Map<string, Set<string>> {
  return useMemo(() => {
    const bySession = new Map<
      string,
      Set<string>
    >();
    for (const session of sessions) {
      const states = new Set<string>(
        session.workflowStates ?? [],
      );
      if (states.size === 0) {
        for (const entry of session.entries) {
          if (
            entry.kind === "prompt" &&
            entry.prompt
          ) {
            collectWorkflowStatesFromText(
              entry.prompt,
              states,
            );
          } else if (
            entry.kind === "response" &&
            entry.raw
          ) {
            collectWorkflowStatesFromText(
              entry.raw,
              states,
            );
          }
        }
      }
      bySession.set(session.sessionId, states);
    }
    return bySession;
  }, [sessions]);
}

function usePickerCallbacks(
  entryRefsRef: React.MutableRefObject<
    Map<string, HTMLDivElement>
  >,
  highlightTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>,
  setSelected: (id: string | null) => void,
  setHighlighted: React.Dispatch<React.SetStateAction<string | null>>,
  setMsgFilters: React.Dispatch<
    React.SetStateAction<Set<string>>
  >,
  setStepFilters: React.Dispatch<
    React.SetStateAction<Set<WorkflowStepFilterId>>
  >,
  setThinkVis: React.Dispatch<
    React.SetStateAction<boolean>
  >,
) {
  const entryRefCallback = useCallback(
    (id: string, node: HTMLDivElement | null) => {
      if (node)
        entryRefsRef.current.set(id, node);
      else entryRefsRef.current.delete(id);
    },
    [entryRefsRef],
  );

  const selectInteraction = useCallback(
    (id: string) => {
      setSelected(id);
      const node =
        entryRefsRef.current.get(id);
      if (node)
        node.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      setHighlighted(id);
      if (highlightTimerRef.current)
        clearTimeout(
          highlightTimerRef.current,
        );
      highlightTimerRef.current = setTimeout(
        () => {
          setHighlighted(
            (curr: string | null) =>
              curr === id ? null : curr,
          );
        },
        3000,
      );
    },
    [
      entryRefsRef,
      highlightTimerRef,
      setSelected,
      setHighlighted,
    ],
  );

  const toggleTypeFilter = useCallback(
    (type: string) => {
      setMsgFilters((prev) => {
        const next = new Set(prev);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        return next;
      });
    },
    [setMsgFilters],
  );

  const toggleWorkflowStepFilter = useCallback(
    (stepId: WorkflowStepFilterId) => {
      setStepFilters((prev) => {
        const next = new Set(prev);
        if (next.has(stepId))
          next.delete(stepId);
        else next.add(stepId);
        return next;
      });
    },
    [setStepFilters],
  );

  const clearFilters = useCallback(() => {
    setMsgFilters(new Set());
    setStepFilters(new Set());
  }, [setMsgFilters, setStepFilters]);

  const toggleThinkingDetail = useCallback(() => {
    setThinkVis((prev) => !prev);
  }, [setThinkVis]);

  return {
    entryRefCallback,
    selectInteraction,
    toggleTypeFilter,
    toggleWorkflowStepFilter,
    clearFilters,
    toggleThinkingDetail,
  };
}

function useFilterEntry(
  messageTypeFilters: Set<string>,
  thinkingDetailVisible: boolean,
  workflowStepFilters: Set<WorkflowStepFilterId>,
  sessionWorkflowStates: Map<
    string,
    Set<string>
  >,
) {
  const sessionMatchesWorkflow = useCallback(
    (
      session: AgentHistorySession,
    ): boolean => {
      if (workflowStepFilters.size === 0)
        return true;
      const states =
        sessionWorkflowStates.get(
          session.sessionId,
        );
      if (!states || states.size === 0)
        return false;
      for (const stepId of workflowStepFilters) {
        const stepDef =
          WORKFLOW_FILTER_BY_ID.get(stepId);
        if (!stepDef) continue;
        if (
          states.has(stepDef.states[0]) ||
          states.has(stepDef.states[1])
        ) {
          return true;
        }
      }
      return false;
    },
    [workflowStepFilters, sessionWorkflowStates],
  );

  return useCallback(
    (
      entry: AgentHistoryEntry,
      session: AgentHistorySession,
    ): boolean => {
      if (!sessionMatchesWorkflow(session))
        return false;
      if (entry.kind !== "response") return true;
      if (!entry.raw) return false;
      try {
        const parsed = JSON.parse(
          entry.raw.trim(),
        );
        const type =
          typeof parsed.type === "string"
            ? parsed.type
            : "";
        if (messageTypeFilters.size > 0) {
          return messageTypeFilters.has(type);
        }
        if (
          !shouldShowHistoryResponseType(
            type,
            thinkingDetailVisible,
            parsed,
          )
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    [
      messageTypeFilters,
      thinkingDetailVisible,
      sessionMatchesWorkflow,
    ],
  );
}

// Re-export component from dedicated UI file
export { InteractionPicker } from "@/components/interaction-picker-ui";
