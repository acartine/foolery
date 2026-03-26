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
  return (
    <section className={
      "rounded-lg border border-white/10"
      + " bg-[#1a1a2e] font-mono text-[#e0e0e0]"
      + " subpixel-antialiased"
      + " shadow-[0_12px_32px_"
      + "rgba(8,12,24,0.32)]"
    }>
      <ConversationLogHeader {...props} />
      {props.loadedSummary
        && props.sessions.length > 0 ? (
        <InteractionPicker
          picker={props.picker}
        />
      ) : null}
      {props.loadedSummary
        && props.sessions.length > 0 ? (
        <SessionPicker {...props} />
      ) : null}
      <ConversationLogBody {...props} />
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
}: ConversationLogProps) {
  return (
    <div className={
      "flex flex-wrap items-center gap-2"
      + " border-b border-white/10"
      + " bg-[#16162a] px-3 py-2"
    }>
      <TerminalSquare className={
        "size-5 text-cyan-200"
      } />
      <p className={
        "text-[17px] font-semibold"
        + " tracking-[0.08em] text-white"
      }>
        Conversation Log
      </p>
      {loadedSummary ? (
        <span className={
          "max-w-[40ch] truncate"
          + " text-[15px] text-white/80"
        }>
          {loadedTitle}
        </span>
      ) : null}
      {loadedSummary ? (
        <button
          type="button"
          className={
            "font-mono text-[14px]"
            + " text-white/65 underline-offset-2"
            + " hover:text-white hover:underline"
          }
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
          className={
            "h-7 gap-1.5 border"
            + " border-white/10 bg-white/5"
            + " px-2.5 font-mono text-[13px]"
            + " text-white/80 hover:bg-white/10"
            + " hover:text-white"
          }
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
        <span className={
          "ml-auto inline-flex items-center"
          + " gap-1.5 text-[13px] text-white/60"
        }>
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
}: ConversationLogProps) {
  return (
    <div className={
      "flex flex-wrap items-center gap-2"
      + " border-b border-white/10"
      + " bg-[#16162a] px-3 py-2 text-[14px]"
    }>
      <span className={
        "font-semibold uppercase"
        + " tracking-[0.18em] text-white/75"
      }>
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
                ? "border-cyan-300/40"
                  + " bg-cyan-400/12"
                  + " text-cyan-50"
                  + " shadow-[0_0_0_1px_"
                  + "rgba(34,211,238,0.18)]"
                : "border-white/10 bg-white/5"
                  + " text-white/70"
                  + " hover:border-white/20"
                  + " hover:bg-white/10"
                  + " hover:text-white",
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
        <span className={
          "ml-auto text-[13px] text-white/60"
        }>
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
}: ConversationLogProps) {
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
          "max-h-[calc(100vh-500px)]"
            + " overflow-y-auto bg-[#1a1a2e] p-3"
            + " outline-none focus-visible:ring-1"
            + " focus-visible:ring-cyan-500/60",
          showDebug
            ? "border-r border-white/10"
            : "",
        )}
      >
        <ConsolePanelContent
          loadedSummary={loadedSummary}
          loadedDetail={loadedDetail}
          sessions={sessions}
          sessionsQuery={sessionsQuery}
          picker={picker}
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
}: {
  loadedSummary: AgentHistoryBeatSummary | null;
  loadedDetail: Beat | null;
  sessions: AgentHistorySession[];
  sessionsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  picker: InteractionPickerState;
}) {
  if (!loadedSummary) {
    return (
      <DashedMessage tone="text-white/75">
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
      />
    );
  }

  if (sessions.length === 0) {
    return (
      <DashedMessage tone="text-white/70">
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
    />
  );
}

function DashedMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: string;
}) {
  return (
    <div className={
      "rounded border border-dashed"
      + " border-white/15 bg-[#16162a]"
      + " px-4 py-7 text-center font-mono"
      + ` text-[15px] leading-6 ${tone}`
    }>
      {children}
    </div>
  );
}

function LoadingLogsMessage({
  loadedSummary,
  loadedDetail,
}: {
  loadedSummary: AgentHistoryBeatSummary;
  loadedDetail: Beat | null;
}) {
  const label = displayBeatLabel(
    loadedSummary.beatId,
    loadedDetail?.aliases,
  );
  return (
    <div className={
      "flex flex-col items-center gap-2"
      + " rounded border border-dashed"
      + " border-white/15 bg-[#16162a]"
      + " px-4 py-7 font-mono text-[15px]"
      + " text-[#e0e0e0]"
    }>
      <Spinner className="size-5" />
      <span>Loading logs for {label}…</span>
      <span className={
        "text-[14px] text-white/60"
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
}: {
  sessions: AgentHistorySession[];
  sessionsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  picker: InteractionPickerState;
}) {
  return (
    <div className="space-y-2">
      {sessionsQuery.isFetching
        && !sessionsQuery.isLoading ? (
        <div className={
          "flex items-center gap-1.5"
          + " text-[14px] text-white/70"
        }>
          <Spinner className="size-4" />
          <span>Refreshing…</span>
        </div>
      ) : null}
      <div className={
        "flex items-center gap-2"
        + " text-[15px] text-[#e0e0e0]"
      }>
        <Workflow className={
          "size-5 text-cyan-200"
        } />
        <Sparkles className={
          "size-5 text-cyan-200"
        } />
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
