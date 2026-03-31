"use client";

import type { MutableRefObject } from "react";
import {
  Bug,
  Clock3,
  Moon,
  Sun,
  TerminalSquare,
} from "lucide-react";
import type {
  AgentHistoryBeatSummary,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import type { Beat } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  displayBeatLabel,
} from "@/lib/beat-display";
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
} from "./agent-history-utils";
import {
  TabBar,
  SessionPicker,
  ConsolePanelContent,
} from "./conversation-log-panels";

export type ConversationTab =
  | "console"
  | "debug";

interface ConversationLogProps {
  loadedSummary:
    | AgentHistoryBeatSummary
    | null;
  loadedTitle: string | null;
  loadedDetail: Beat | null;
  sessions: AgentHistorySession[];
  sessionsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  picker: InteractionPickerState;
  selectedDebugSession:
    | AgentHistorySession
    | null;
  selectedSessionId: string | null;
  setSelectedSessionId: (
    id: string | null,
  ) => void;
  activeTab: ConversationTab;
  setActiveTab: (tab: ConversationTab) => void;
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
  const themePref =
    useTerminalThemePreference();
  const theme = getConversationLogTheme(
    themePref.lightTheme,
  );
  const hasSessions =
    !!props.loadedSummary
    && props.sessions.length > 0;

  return (
    <section className={cn(
      "rounded-lg border font-mono"
      + " subpixel-antialiased",
      theme.container,
    )}>
      <ConversationLogHeader
        {...props}
        lightTheme={themePref.lightTheme}
        setLightTheme={themePref.setLightTheme}
      />
      {hasSessions ? (
        <InteractionPicker
          picker={props.picker}
          theme={theme}
        />
      ) : null}
      {hasSessions ? (
        <SessionPicker
          sessions={props.sessions}
          selectedDebugSession={
            props.selectedDebugSession
          }
          setSelectedSessionId={
            props.setSelectedSessionId
          }
          lightTheme={themePref.lightTheme}
        />
      ) : null}
      {hasSessions ? (
        <TabBar
          activeTab={props.activeTab}
          setActiveTab={props.setActiveTab}
          lightTheme={themePref.lightTheme}
        />
      ) : null}
      <ConversationLogBody
        {...props}
        lightTheme={themePref.lightTheme}
      />
    </section>
  );
}

/* ── Header ── */

function ConversationLogHeader({
  loadedSummary,
  loadedDetail,
  loadedTitle,
  sessions,
  activeTab,
  setActiveTab,
  copyBeatId,
  lightTheme,
  setLightTheme,
}: ConversationLogProps & {
  lightTheme: boolean;
  setLightTheme: (v: boolean) => void;
}) {
  const theme = getConversationLogTheme(
    lightTheme,
  );
  return (
    <div className={cn(
      "flex flex-wrap items-center"
      + " gap-2 px-3 py-2",
      theme.sectionHeader,
    )}>
      <TerminalSquare className={cn(
        "size-5", theme.icon,
      )} />
      <HeaderTitle
        title={loadedTitle}
        hasLoaded={!!loadedSummary}
        theme={theme}
      />
      <HeaderBeatId
        loadedSummary={loadedSummary}
        loadedDetail={loadedDetail}
        copyBeatId={copyBeatId}
        theme={theme}
      />
      <HeaderActions
        summary={loadedSummary}
        sessions={sessions}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lightTheme={lightTheme}
        setLightTheme={setLightTheme}
        theme={theme}
      />
    </div>
  );
}

function HeaderTitle({
  title,
  hasLoaded,
  theme,
}: {
  title: string | null;
  hasLoaded: boolean;
  theme: ReturnType<
    typeof getConversationLogTheme
  >;
}) {
  return (
    <>
      <p className={cn(
        "text-[17px] font-semibold"
        + " tracking-[0.08em]",
        theme.heading,
      )}>
        Conversation Log
      </p>
      {hasLoaded && title ? (
        <span className={cn(
          "max-w-[40ch] truncate text-[15px]",
          theme.muted,
        )}>
          {title}
        </span>
      ) : null}
    </>
  );
}

function HeaderBeatId({
  loadedSummary,
  loadedDetail,
  copyBeatId,
  theme,
}: {
  loadedSummary: AgentHistoryBeatSummary | null;
  loadedDetail: Beat | null;
  copyBeatId: (id: string) => void;
  theme: ReturnType<
    typeof getConversationLogTheme
  >;
}) {
  if (!loadedSummary) return null;
  return (
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
  );
}

function HeaderActions({
  summary,
  sessions,
  activeTab,
  setActiveTab,
  lightTheme,
  setLightTheme,
  theme,
}: {
  summary: AgentHistoryBeatSummary | null;
  sessions: AgentHistorySession[];
  activeTab: ConversationTab;
  setActiveTab: (t: ConversationTab) => void;
  lightTheme: boolean;
  setLightTheme: (v: boolean) => void;
  theme: ReturnType<
    typeof getConversationLogTheme
  >;
}) {
  return (
    <>
      {summary && sessions.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className={theme.debugButton}
          onClick={() => setActiveTab(
            activeTab === "debug"
              ? "console"
              : "debug",
          )}
        >
          <Bug className="size-4" />
          {activeTab === "debug"
            ? "Close Debug"
            : "Debug"}
        </Button>
      ) : null}
      <ThemeToggle
        lightTheme={lightTheme}
        setLightTheme={setLightTheme}
        theme={theme}
      />
      {summary ? (
        <span className={cn(
          "ml-auto inline-flex items-center"
          + " gap-1.5 text-[13px]",
          theme.muted,
        )}>
          <Clock3 className="size-4" />
          Last updated{" "}
          {relativeTime(summary.lastWorkedAt)}
        </span>
      ) : null}
    </>
  );
}

function ThemeToggle({
  lightTheme,
  setLightTheme,
  theme,
}: {
  lightTheme: boolean;
  setLightTheme: (v: boolean) => void;
  theme: ReturnType<
    typeof getConversationLogTheme
  >;
}) {
  return (
    <label className={
      "inline-flex items-center"
      + " gap-1.5 rounded px-1 py-0.5"
    }>
      {lightTheme
        ? <Sun className={
            "size-3.5 text-amber-500"
          } />
        : <Moon className={
            "size-3.5 text-slate-400"
          } />}
      <span className={cn(
        "text-[11px]", theme.muted,
      )}>
        Light Theme
      </span>
      <Switch
        checked={lightTheme}
        onCheckedChange={setLightTheme}
        aria-label="Light Theme"
        className={
          lightTheme
            ? "data-[state=checked]:bg-amber-500"
              + " data-[state=unchecked]:"
              + "bg-slate-300"
            : "data-[state=checked]:bg-cyan-600"
              + " data-[state=unchecked]:"
              + "bg-white/20"
        }
      />
    </label>
  );
}

/* ── Body ── */

function ConversationLogBody({
  loadedSummary,
  loadedTitle,
  loadedDetail,
  sessions,
  sessionsQuery,
  picker,
  selectedDebugSession,
  activeTab,
  consolePanelRef,
  beatListRef,
  lightTheme,
}: ConversationLogProps & {
  lightTheme: boolean;
}) {
  const theme = getConversationLogTheme(
    lightTheme,
  );

  if (
    activeTab === "debug"
    && sessions.length > 0
    && selectedDebugSession
    && loadedSummary
  ) {
    return (
      <div className="overflow-y-auto">
        <HistoryDebugPanel
          beatId={loadedSummary.beatId}
          session={selectedDebugSession}
          repoPath={loadedSummary.repoPath}
          beatTitle={
            loadedTitle ?? undefined
          }
        />
      </div>
    );
  }

  return (
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
  );
}
