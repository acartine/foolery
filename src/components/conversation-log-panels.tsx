"use client";

import {
  Bug,
  Sparkles,
  Workflow,
} from "lucide-react";
import type {
  AgentHistoryBeatSummary,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import type { Beat } from "@/lib/types";
import { cn } from "@/lib/utils";
import type {
  UseQueryResult,
} from "@tanstack/react-query";
import type {
  AgentHistoryPayload,
} from "@/lib/agent-history-types";
import type { BdResult } from "@/lib/types";
import type {
  InteractionPickerState,
} from "@/components/interaction-picker";
import {
  getConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";
import {
  displayBeatLabel,
} from "@/lib/beat-display";
import {
  Spinner,
} from "./agent-history-utils";
import {
  SessionCard,
} from "./agent-history-session-card";
import type {
  ConversationTab,
} from "./agent-history-conversation-log";

/* ── Tab bar ── */

export function TabBar({
  activeTab,
  setActiveTab,
  lightTheme,
}: {
  activeTab: ConversationTab;
  setActiveTab: (tab: ConversationTab) => void;
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(
    lightTheme,
  );
  const base =
    "px-4 py-2 text-[13px] font-semibold"
    + " uppercase tracking-[0.12em]"
    + " transition-colors";
  return (
    <div className={cn("flex gap-0", theme.tabBar)}>
      <button
        type="button"
        onClick={() => setActiveTab("console")}
        className={cn(
          base,
          activeTab === "console"
            ? theme.tabActive
            : theme.tabInactive,
        )}
      >
        Console
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("debug")}
        className={cn(
          base,
          activeTab === "debug"
            ? theme.tabActive
            : theme.tabInactive,
        )}
      >
        <Bug className="mr-1 inline size-4" />
        Debug
      </button>
    </div>
  );
}

/* ── Session picker ── */

export function SessionPicker({
  sessions,
  selectedDebugSession,
  setSelectedSessionId,
  lightTheme,
}: {
  sessions: AgentHistorySession[];
  selectedDebugSession:
    | AgentHistorySession
    | null;
  setSelectedSessionId: (
    id: string | null,
  ) => void;
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(
    lightTheme,
  );
  return (
    <div className={cn(
      "flex flex-wrap items-center"
      + " gap-2 px-3 py-2 text-[14px]",
      theme.sectionHeader,
    )}>
      <span className={theme.sessionLabel}>
        Conversation
      </span>
      {sessions.map((session, index) => {
        const selected =
          session.sessionId
          === selectedDebugSession?.sessionId;
        return (
          <button
            key={session.sessionId}
            type="button"
            onClick={() => {
              setSelectedSessionId(
                session.sessionId,
              );
            }}
            className={cn(
              "rounded-full border px-3"
              + " py-1.5 text-[14px] font-mono"
              + " leading-none"
              + " transition-colors",
              selected
                ? theme.sessionTabActive
                : theme.sessionTabInactive,
            )}
            title={
              "Select conversation "
              + `${session.sessionId}`
              + " for debugging"
            }
          >
            {`#${index + 1}`
              + ` ${session.sessionId}`}
          </button>
        );
      })}
      {selectedDebugSession ? (
        <span className={cn(
          "ml-auto text-[13px]",
          theme.muted,
        )}>
          Debug target:{" "}
          {selectedDebugSession.sessionId}
        </span>
      ) : null}
    </div>
  );
}

/* ── Dashed / Loading messages ── */

export function DashedMessage({
  children,
  tone,
  theme,
}: {
  children: React.ReactNode;
  tone: string;
  theme: { dashedBorder: string };
}) {
  return (
    <div className={
      "rounded border border-dashed"
      + " px-4 py-7 text-center font-mono"
      + " text-[15px] leading-6 "
      + theme.dashedBorder
      + ` ${tone}`
    }>
      {children}
    </div>
  );
}

export function LoadingLogsMessage({
  loadedSummary,
  loadedDetail,
  theme,
}: {
  loadedSummary: AgentHistoryBeatSummary;
  loadedDetail: Beat | null;
  theme: {
    loadingContainer: string;
    loadingMuted: string;
  };
}) {
  const label = displayBeatLabel(
    loadedSummary.beatId,
    loadedDetail?.aliases,
  );
  return (
    <div className={
      "flex flex-col items-center gap-2"
      + " rounded border border-dashed"
      + " px-4 py-7 font-mono text-[15px] "
      + theme.loadingContainer
    }>
      <Spinner className="size-5" />
      <span>Loading logs for {label}…</span>
      <span className={
        "text-[14px] " + theme.loadingMuted
      }>
        prompt histories are BIG,
        please be patient :-)
      </span>
    </div>
  );
}

/* ── Sessions list ── */

export function SessionsList({
  sessions,
  sessionsQuery,
  picker,
  lightTheme,
}: {
  sessions: AgentHistorySession[];
  sessionsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  picker: InteractionPickerState;
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(
    lightTheme,
  );

  return (
    <div className="space-y-2">
      {sessionsQuery.isFetching
        && !sessionsQuery.isLoading ? (
        <div className={cn(
          "flex items-center gap-1.5"
          + " text-[14px]",
          theme.refreshingText,
        )}>
          <Spinner className="size-4" />
          <span>Refreshing…</span>
        </div>
      ) : null}
      <div className={cn(
        "flex items-center gap-2"
        + " text-[15px]",
        theme.countText,
      )}>
        <Workflow className={cn(
          "size-5",
          theme.icon,
        )} />
        <Sparkles className={cn(
          "size-5",
          theme.icon,
        )} />
        {sessions.length} session
        {sessions.length === 1 ? "" : "s"}
      </div>
      {sessions.map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          entryRefCallback={
            picker.entryRefCallback
          }
          highlightedEntryId={
            picker.highlightedEntryId
          }
          filterEntry={picker.filterEntry}
          theme={theme}
        />
      ))}
    </div>
  );
}

/* ── Console panel content ── */

export function ConsolePanelContent({
  loadedSummary,
  loadedDetail,
  sessions,
  sessionsQuery,
  picker,
  lightTheme,
}: {
  loadedSummary:
    | AgentHistoryBeatSummary
    | null;
  loadedDetail: Beat | null;
  sessions: AgentHistorySession[];
  sessionsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  picker: InteractionPickerState;
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(
    lightTheme,
  );
  if (!loadedSummary) {
    return (
      <DashedMessage
        tone={
          lightTheme
            ? "text-ink-700"
            : "text-white/75"
        }
        theme={theme}
      >
        Use click or Enter on a focused beat
        to load app and agent logs.
      </DashedMessage>
    );
  }

  if (
    sessionsQuery.isLoading
    && sessions.length === 0
  ) {
    return (
      <LoadingLogsMessage
        loadedSummary={loadedSummary}
        loadedDetail={loadedDetail}
        theme={theme}
      />
    );
  }

  if (sessions.length === 0) {
    return (
      <DashedMessage
        tone={
          lightTheme
            ? "text-ink-600"
            : "text-white/70"
        }
        theme={theme}
      >
        No captured log sessions for
        this beat yet.
      </DashedMessage>
    );
  }

  return (
    <SessionsList
      sessions={sessions}
      sessionsQuery={sessionsQuery}
      picker={picker}
      lightTheme={lightTheme}
    />
  );
}
