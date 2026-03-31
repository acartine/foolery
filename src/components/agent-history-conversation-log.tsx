"use client";

import type { MutableRefObject } from "react";
import {
  Bug,
  Clock3,
  Sparkles,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import type {
  AgentHistoryBeatSummary,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import type { Beat } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { displayBeatLabel } from "@/lib/beat-display";
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
  InteractionPicker,
} from "@/components/interaction-picker";
import {
  HistoryDebugPanel,
} from "@/components/history-debug-panel";
import {
  getConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";
import {
  useTerminalThemePreference,
} from "@/hooks/use-terminal-theme-preference";
import {
  relativeTime,
  Spinner,
} from "./agent-history-utils";
import {
  SessionCard,
} from "./agent-history-session-card";

interface ConversationLogProps {
  loadedSummary: AgentHistoryBeatSummary | null;
  loadedTitle: string | null;
  loadedDetail: Beat | null;
  sessions: AgentHistorySession[];
  sessionsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  picker: InteractionPickerState;
  selectedDebugSession: AgentHistorySession | null;
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  debugPanelOpen: boolean;
  setDebugPanelOpen: (
    fn: (prev: boolean) => boolean,
  ) => void;
  copyBeatId: (id: string) => void;
  consolePanelRef: MutableRefObject<
    HTMLDivElement | null
  >;
  beatListRef: MutableRefObject<
    HTMLDivElement | null
  >;
}

export function AgentHistoryConversationLog(
  props: ConversationLogProps,
) {
  const { lightTheme } = useTerminalThemePreference();
  const theme = getConversationLogTheme(lightTheme);

  return (
    <section className={cn(
      "rounded-lg border font-mono subpixel-antialiased",
      theme.container,
    )}>
      <ConversationLogHeader
        {...props}
        lightTheme={lightTheme}
      />
      {props.loadedSummary
        && props.sessions.length > 0 ? (
        <InteractionPicker
          picker={props.picker}
        />
      ) : null}
      {props.loadedSummary
        && props.sessions.length > 0 ? (
        <SessionPicker
          {...props}
          lightTheme={lightTheme}
        />
      ) : null}
      <ConversationLogBody
        {...props}
        lightTheme={lightTheme}
      />
    </section>
  );
}

function ConversationLogHeader({
  loadedSummary,
  loadedTitle,
  loadedDetail,
  sessions,
  debugPanelOpen,
  setDebugPanelOpen,
  copyBeatId,
  lightTheme,
}: ConversationLogProps & {
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(lightTheme);

  return (
    <div className={cn(
      "flex flex-wrap items-center gap-2 px-3 py-2",
      theme.sectionHeader,
    )}>
      <TerminalSquare className={cn("size-5", theme.icon)} />
      <p className={cn(
        "text-[17px] font-semibold tracking-[0.08em]",
        theme.heading,
      )}>
        Conversation Log
      </p>
      {loadedSummary ? (
        <span className={cn(
          "max-w-[40ch] truncate text-[15px]",
          theme.muted,
        )}>
          {loadedTitle}
        </span>
      ) : null}
      {loadedSummary ? (
        <button
          type="button"
          className={cn(
            "font-mono text-[14px]",
            theme.link,
          )}
          onClick={() => {
            copyBeatId(loadedSummary.beatId);
          }}
          title="Click to copy ID"
        >
          {displayBeatLabel(loadedSummary.beatId, loadedDetail?.aliases)}
        </button>
      ) : null}
      {loadedSummary && sessions.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className={theme.debugButton}
          onClick={() => {
            setDebugPanelOpen((prev) => !prev);
          }}
        >
          <Bug className="size-4" />
          {debugPanelOpen
            ? "Close Debug"
            : "Debug"}
        </Button>
      ) : null}
      {loadedSummary ? (
        <span className={cn(
          "ml-auto inline-flex items-center gap-1.5 text-[13px]",
          theme.muted,
        )}>
          <Clock3 className="size-4" />
          Last updated{" "}
          {relativeTime(loadedSummary.lastWorkedAt)}
        </span>
      ) : null}
    </div>
  );
}

function SessionPicker({
  sessions,
  selectedDebugSession,
  setSelectedSessionId,
  lightTheme,
}: Pick<
  ConversationLogProps,
  "sessions"
  | "selectedDebugSession"
  | "setSelectedSessionId"
> & {
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(lightTheme);

  return (
    <div className={cn(
      "flex flex-wrap items-center gap-2 px-3 py-2 text-[14px]",
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
              "rounded-full border px-3 py-1.5"
                + " text-[14px] font-mono"
                + " leading-none"
                + " transition-colors",
              selected
                ? theme.sessionTabActive
                : theme.sessionTabInactive,
            )}
            title={
              "Select conversation "
              + `${session.sessionId} for debugging`
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

function ConversationLogBody({
  loadedSummary,
  loadedTitle,
  loadedDetail,
  sessions,
  sessionsQuery,
  picker,
  selectedDebugSession,
  debugPanelOpen,
  consolePanelRef,
  beatListRef,
  lightTheme,
}: ConversationLogProps & {
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(lightTheme);
  const showDebug =
    debugPanelOpen && sessions.length > 0;
  return (
    <div className={
      showDebug
        ? "grid grid-cols-2 gap-0"
        : ""
    }>
      <div
        ref={consolePanelRef}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.key === "Tab"
            && event.shiftKey
          ) {
            event.preventDefault();
            beatListRef.current?.focus();
          }
        }}
        className={cn(
          "max-h-[calc(100vh-500px)]",
          theme.panel,
          showDebug
            ? theme.panelDivider
            : "",
        )}
      >
        <ConsolePanelContent
          loadedSummary={loadedSummary}
          loadedDetail={loadedDetail}
          sessions={sessions}
          sessionsQuery={sessionsQuery}
          picker={picker}
          lightTheme={lightTheme}
        />
      </div>
      {showDebug
        && selectedDebugSession
        && loadedSummary ? (
        <div className={
          "max-h-[calc(100vh-500px)]"
          + " overflow-y-auto"
        }>
          <HistoryDebugPanel
            beatId={loadedSummary.beatId}
            session={selectedDebugSession}
            repoPath={loadedSummary.repoPath}
            beatTitle={
              loadedTitle ?? undefined
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function ConsolePanelContent({
  loadedSummary,
  loadedDetail,
  sessions,
  sessionsQuery,
  picker,
  lightTheme,
}: {
  loadedSummary: AgentHistoryBeatSummary | null;
  loadedDetail: Beat | null;
  sessions: AgentHistorySession[];
  sessionsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  picker: InteractionPickerState;
  lightTheme: boolean;
}) {
  if (!loadedSummary) {
    return (
      <DashedMessage
        tone={
          lightTheme
            ? "text-slate-700"
            : "text-white/75"
        }
        lightTheme={lightTheme}
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
        lightTheme={lightTheme}
      />
    );
  }

  if (sessions.length === 0) {
    return (
      <DashedMessage
        tone={
          lightTheme
            ? "text-slate-600"
            : "text-white/70"
        }
        lightTheme={lightTheme}
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

function DashedMessage({
  children,
  tone,
  lightTheme,
}: {
  children: React.ReactNode;
  tone: string;
  lightTheme: boolean;
}) {
  return (
    <div className={
      "rounded border border-dashed px-4 py-7"
      + " text-center font-mono text-[15px] leading-6"
      + ` ${lightTheme
        ? "border-slate-300 bg-white"
        : "border-white/15 bg-[#16162a]"}`
      + ` ${tone}`
    }>
      {children}
    </div>
  );
}

function LoadingLogsMessage({
  loadedSummary,
  loadedDetail,
  lightTheme,
}: {
  loadedSummary: AgentHistoryBeatSummary;
  loadedDetail: Beat | null;
  lightTheme: boolean;
}) {
  const label = displayBeatLabel(
    loadedSummary.beatId,
    loadedDetail?.aliases,
  );
  return (
    <div className={
      "flex flex-col items-center gap-2 rounded"
      + " border border-dashed px-4 py-7"
      + " font-mono text-[15px]"
      + ` ${lightTheme
        ? "border-slate-300 bg-white text-slate-900"
        : "border-white/15 bg-[#16162a]"
          + " text-[#e0e0e0]"}`
    }>
      <Spinner className="size-5" />
      <span>Loading logs for {label}…</span>
      <span className={
        `text-[14px] ${lightTheme
          ? "text-slate-600"
          : "text-white/60"}`
      }>
        prompt histories are BIG,
        please be patient :-)
      </span>
    </div>
  );
}

function SessionsList({
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
  const theme = getConversationLogTheme(lightTheme);

  return (
    <div className="space-y-2">
      {sessionsQuery.isFetching
        && !sessionsQuery.isLoading ? (
        <div className={cn(
          "flex items-center gap-1.5 text-[14px]",
          theme.refreshingText,
        )}>
          <Spinner className="size-4" />
          <span>Refreshing…</span>
        </div>
      ) : null}
      <div className={cn(
        "flex items-center gap-2 text-[15px]",
        theme.countText,
      )}>
        <Workflow className={cn("size-5", theme.icon)} />
        <Sparkles className={cn("size-5", theme.icon)} />
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
        />
      ))}
    </div>
  );
}
