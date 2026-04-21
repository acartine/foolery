"use client";

import { useMemo } from "react";
import { MessageSquareText } from "lucide-react";
import type {
  AgentHistoryEntry,
  AgentHistoryInteractionType,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { Badge } from "@/components/ui/badge";
import type {
  ConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";
import {
  buildAgentLabel,
  formatTime,
  promptSourceLabel,
  workflowStateBadgeLabel,
} from "./agent-history-utils";
import {
  ResponseEntryRow,
} from "./agent-history-response-row";

export interface PromptContext {
  source?: string;
  promptNumber?: number;
  workflowState?: string;
}

export function SessionCard({
  session,
  entryRefCallback,
  highlightedEntryId,
  filterEntry,
  theme,
}: {
  session: AgentHistorySession;
  entryRefCallback?: (
    id: string,
    node: HTMLDivElement | null,
  ) => void;
  highlightedEntryId?: string | null;
  filterEntry?: (
    entry: AgentHistoryEntry,
    session: AgentHistorySession,
  ) => boolean;
  theme: ConversationLogTheme;
}) {
  const agentLabel = useMemo(
    () => buildAgentLabel(
      session.agentName,
      session.agentModel,
      session.agentVersion,
    ),
    [
      session.agentName,
      session.agentModel,
      session.agentVersion,
    ],
  );

  const enrichedEntries = useMemo(() => {
    const result: Array<{
      entry: AgentHistoryEntry;
      precedingPrompt?: PromptContext;
    }> = [];
    let tracking: PromptContext | undefined;
    for (const entry of session.entries) {
      result.push({
        entry,
        precedingPrompt:
          entry.kind === "response"
            ? tracking
            : undefined,
      });
      if (entry.kind === "prompt") {
        tracking = {
          ...(entry.promptSource
            ? { source: entry.promptSource }
            : {}),
          ...(typeof entry.promptNumber
            === "number"
            ? {
              promptNumber: entry.promptNumber,
            }
            : {}),
          ...(entry.workflowState
            ? {
              workflowState:
                  entry.workflowState,
            }
            : {}),
        };
      }
    }
    return result;
  }, [session.entries]);

  const filteredEntries = useMemo(() => {
    if (!filterEntry) return enrichedEntries;
    return enrichedEntries.filter(
      ({ entry }) => filterEntry(entry, session),
    );
  }, [enrichedEntries, filterEntry, session]);

  return (
    <SessionCardShell
      session={session}
      agentLabel={agentLabel}
      filteredEntries={filteredEntries}
      hasEnriched={enrichedEntries.length > 0}
      entryRefCallback={entryRefCallback}
      highlightedEntryId={highlightedEntryId}
      theme={theme}
    />
  );
}

function SessionCardShell({
  session,
  agentLabel,
  filteredEntries,
  hasEnriched,
  entryRefCallback,
  highlightedEntryId,
  theme,
}: {
  session: AgentHistorySession;
  agentLabel?: string;
  filteredEntries: Array<{
    entry: AgentHistoryEntry;
    precedingPrompt?: PromptContext;
  }>;
  hasEnriched: boolean;
  entryRefCallback?: (
    id: string,
    node: HTMLDivElement | null,
  ) => void;
  highlightedEntryId?: string | null;
  theme: ConversationLogTheme;
}) {
  return (
    <section className={theme.cardShell}>
      <SessionCardHeader
        session={session}
        agentLabel={agentLabel}
        theme={theme}
      />
      <div className="space-y-2 p-3">
        {filteredEntries.length === 0 ? (
          <EmptySessionMessage
            hasEnriched={hasEnriched}
            theme={theme}
          />
        ) : (
          filteredEntries.map(
            ({ entry, precedingPrompt }) => (
              <SessionEntryWrapper
                key={entry.id}
                entry={entry}
                agentLabel={agentLabel}
                interactionType={
                  session.interactionType
                }
                precedingPrompt={precedingPrompt}
                entryRefCallback={
                  entryRefCallback
                }
                highlighted={
                  highlightedEntryId === entry.id
                }
                theme={theme}
              />
            ),
          )
        )}
      </div>
    </section>
  );
}

function SessionCardHeader({
  session,
  agentLabel,
  theme,
}: {
  session: AgentHistorySession;
  agentLabel?: string;
  theme: ConversationLogTheme;
}) {
  const iTypeTone = interactionBadgeTone(
    session.interactionType,
    theme,
  );
  const sTone = statusBadgeTone(
    session.status,
    theme,
  );
  return (
    <header className={theme.cardHeader}>
      <div className={
        "flex flex-wrap items-center gap-2"
      }>
        <Badge
          variant="outline"
          className={
            "text-[13px] uppercase " + iTypeTone
          }
        >
          {interactionTypeLabel(
            session.interactionType,
          )}
        </Badge>
        <Badge
          variant="outline"
          className={"text-[13px] " + sTone}
        >
          {session.status ?? "unknown"}
        </Badge>
        {agentLabel ? (
          <span className={
            "font-mono text-[15px] "
            + theme.cardText
          }>
            {agentLabel}
          </span>
        ) : null}
        <span className={
          "font-mono text-[14px] "
          + theme.cardMuted
        }>
          {session.sessionId}
        </span>
        <span className={
          "ml-auto text-[14px] "
          + theme.cardMuted
        }>
          {formatTime(session.updatedAt)}
        </span>
      </div>
    </header>
  );
}

function EmptySessionMessage({
  hasEnriched,
  theme,
}: {
  hasEnriched: boolean;
  theme: ConversationLogTheme;
}) {
  return (
    <div className={theme.emptySession}>
      {hasEnriched
        ? "No entries match the active filters."
        : "No log entries captured"
          + " for this session."}
    </div>
  );
}

function SessionEntryWrapper({
  entry,
  agentLabel,
  interactionType,
  precedingPrompt,
  entryRefCallback,
  highlighted,
  theme,
}: {
  entry: AgentHistoryEntry;
  agentLabel?: string;
  interactionType?: AgentHistoryInteractionType;
  precedingPrompt?: PromptContext;
  entryRefCallback?: (
    id: string,
    node: HTMLDivElement | null,
  ) => void;
  highlighted: boolean;
  theme: ConversationLogTheme;
}) {
  return (
    <div
      ref={(node) => {
        entryRefCallback?.(entry.id, node);
      }}
      className={
        highlighted
          ? theme.highlightRing
          : "transition-all duration-300"
      }
    >
      <SessionEntryRow
        entry={entry}
        agentLabel={agentLabel}
        interactionType={interactionType}
        precedingPrompt={precedingPrompt}
        theme={theme}
      />
    </div>
  );
}

function SessionEntryRow({
  entry,
  agentLabel,
  interactionType,
  precedingPrompt,
  theme,
}: {
  entry: AgentHistoryEntry;
  agentLabel?: string;
  interactionType?: AgentHistoryInteractionType;
  precedingPrompt?: PromptContext;
  theme: ConversationLogTheme;
}) {
  if (entry.kind === "session_start") {
    return (
      <SessionBoundaryRow theme={theme}>
        Session started at {formatTime(entry.ts)}
      </SessionBoundaryRow>
    );
  }
  if (entry.kind === "session_end") {
    return (
      <SessionBoundaryRow theme={theme}>
        Session ended at {formatTime(entry.ts)}
        {entry.status
          ? ` · ${entry.status}`
          : ""}
        {entry.exitCode !== undefined
          ? ` · exit ${entry.exitCode}`
          : ""}
      </SessionBoundaryRow>
    );
  }
  if (entry.kind === "prompt") {
    return (
      <PromptEntryRow
        entry={entry}
        agentLabel={agentLabel}
        theme={theme}
      />
    );
  }
  return (
    <ResponseEntryRow
      entry={entry}
      agentLabel={agentLabel}
      interactionType={interactionType}
      precedingPrompt={precedingPrompt}
      theme={theme}
    />
  );
}

function SessionBoundaryRow({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: ConversationLogTheme;
}) {
  return (
    <div className={theme.boundaryRow}>
      {children}
    </div>
  );
}

function PromptEntryRow({
  entry,
  agentLabel,
  theme,
}: {
  entry: AgentHistoryEntry;
  agentLabel?: string;
  theme: ConversationLogTheme;
}) {
  const stateLabel = workflowStateBadgeLabel(
    entry.workflowState,
  );
  return (
    <div className={theme.promptContainer}>
      <div className={theme.promptHeader}>
        <MessageSquareText
          className={
            "size-5 " + theme.promptIcon
          }
        />
        <span className={
          theme.promptDirectionLabel
        }>
          App -&gt; Agent
          {agentLabel
            ? ` · ${agentLabel}`
            : ""}
        </span>
        {typeof entry.promptNumber
          === "number" ? (
          <Badge
            variant="outline"
            className={theme.promptBadge}
          >
            {`Prompt #${entry.promptNumber}`}
          </Badge>
        ) : null}
        <Badge
          variant="outline"
          className={theme.promptBadge}
        >
          {promptSourceLabel(entry.promptSource)}
        </Badge>
        {stateLabel ? (
          <Badge
            variant="outline"
            className={theme.promptBadge}
          >
            {stateLabel}
          </Badge>
        ) : null}
        <span className={theme.cardMuted}>
          {formatTime(entry.ts)}
        </span>
      </div>
      <pre className={theme.promptBody}>
        {entry.prompt ?? "(empty prompt)"}
      </pre>
    </div>
  );
}

/* badge helpers */

function interactionTypeLabel(
  iType: string,
): string {
  if (iType === "scene") return "scene";
  if (iType === "direct") return "direct";
  return iType;
}

function interactionBadgeTone(
  iType: string,
  theme: ConversationLogTheme,
): string {
  if (iType === "scene")
    return theme.badgeInteractionScene;
  if (iType === "direct")
    return theme.badgeInteractionDirect;
  return theme.badgeInteractionDefault;
}

function statusBadgeTone(
  status: string | undefined,
  theme: ConversationLogTheme,
): string {
  if (status === "completed")
    return theme.badgeStatusCompleted;
  if (status === "error")
    return theme.badgeStatusError;
  if (status === "aborted")
    return theme.badgeStatusAborted;
  if (status === "running")
    return theme.badgeStatusRunning;
  return theme.badgeStatusDefault;
}

/* ResponseEntryRow is in response-row */
