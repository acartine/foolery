"use client";

import { useMemo } from "react";
import { MessageSquareText } from "lucide-react";
import type {
  AgentHistoryEntry,
  AgentHistoryInteractionType,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { Badge } from "@/components/ui/badge";
import {
  buildAgentLabel,
  formatTime,
  interactionTypeLabel,
  interactionTypeTone,
  promptSourceLabel,
  statusTone,
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
}) {
  return (
    <section className={
      "rounded border border-white/10"
      + " bg-[#1a1a2e]"
      + " shadow-[inset_0_1px_0_"
      + "rgba(255,255,255,0.02)]"
    }>
      <SessionCardHeader
        session={session}
        agentLabel={agentLabel}
      />
      <div className="space-y-2 p-3">
        {filteredEntries.length === 0 ? (
          <EmptySessionMessage
            hasEnriched={hasEnriched}
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
}: {
  session: AgentHistorySession;
  agentLabel?: string;
}) {
  return (
    <header className={
      "flex flex-wrap items-center gap-2"
      + " border-b border-white/10"
      + " bg-[#16162a] px-3 py-2"
      + " font-mono text-[14px] leading-6"
      + " text-[#e0e0e0] subpixel-antialiased"
    }>
      <Badge
        variant="outline"
        className={
          "text-[13px] uppercase "
          + interactionTypeTone(
            session.interactionType,
          )
        }
      >
        {interactionTypeLabel(
          session.interactionType,
        )}
      </Badge>
      <Badge
        variant="outline"
        className={
          "text-[13px] "
          + statusTone(session.status)
        }
      >
        {session.status ?? "unknown"}
      </Badge>
      {agentLabel ? (
        <span className={
          "font-mono text-[15px] text-[#e0e0e0]"
        }>
          {agentLabel}
        </span>
      ) : null}
      <span className={
        "font-mono text-[14px] text-white/65"
      }>
        {session.sessionId}
      </span>
      <span className={
        "ml-auto text-[14px] text-white/65"
      }>
        {formatTime(session.updatedAt)}
      </span>
    </header>
  );
}

function EmptySessionMessage(
  { hasEnriched }: { hasEnriched: boolean },
) {
  return (
    <div className={
      "rounded border border-white/10"
      + " bg-[#16162a] px-3 py-2"
      + " font-mono text-[15px] leading-6"
      + " text-[#e0e0e0] subpixel-antialiased"
    }>
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
}) {
  return (
    <div
      ref={(node) => {
        entryRefCallback?.(entry.id, node);
      }}
      className={
        highlighted
          ? "rounded ring-2 ring-cyan-400/70"
            + " shadow-[0_0_0_1px_"
            + "rgba(34,211,238,0.15)]"
            + " transition-all duration-300"
          : "transition-all duration-300"
      }
    >
      <SessionEntryRow
        entry={entry}
        agentLabel={agentLabel}
        interactionType={interactionType}
        precedingPrompt={precedingPrompt}
      />
    </div>
  );
}

function SessionEntryRow({
  entry,
  agentLabel,
  interactionType,
  precedingPrompt,
}: {
  entry: AgentHistoryEntry;
  agentLabel?: string;
  interactionType?: AgentHistoryInteractionType;
  precedingPrompt?: PromptContext;
}) {
  if (entry.kind === "session_start") {
    return (
      <SessionBoundaryRow>
        Session started at {formatTime(entry.ts)}
      </SessionBoundaryRow>
    );
  }
  if (entry.kind === "session_end") {
    return (
      <SessionBoundaryRow>
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
      />
    );
  }
  return (
    <ResponseEntryRow
      entry={entry}
      agentLabel={agentLabel}
      interactionType={interactionType}
      precedingPrompt={precedingPrompt}
    />
  );
}

function SessionBoundaryRow(
  { children }: { children: React.ReactNode },
) {
  return (
    <div className={
      "rounded border border-white/10"
      + " bg-[#16162a] px-3 py-2"
      + " font-mono text-[15px] leading-6"
      + " text-[#e0e0e0] subpixel-antialiased"
    }>
      {children}
    </div>
  );
}

function PromptEntryRow({
  entry,
  agentLabel,
}: {
  entry: AgentHistoryEntry;
  agentLabel?: string;
}) {
  const stateLabel = workflowStateBadgeLabel(
    entry.workflowState,
  );
  const badgeCls =
    "border-cyan-300/40 bg-cyan-400/10"
    + " text-[13px] font-normal text-sky-100";
  return (
    <div className={
      "rounded border border-cyan-400/25"
      + " bg-[#101522] px-3 py-2"
      + " shadow-[inset_0_1px_0_"
      + "rgba(255,255,255,0.03)]"
    }>
      <div className={
        "mb-1.5 flex flex-wrap items-center"
        + " gap-2 font-mono text-[14px]"
        + " leading-6 text-[#e0e0e0]"
        + " subpixel-antialiased"
      }>
        <MessageSquareText
          className="size-5 text-sky-100"
        />
        <span className={
          "font-semibold uppercase"
          + " tracking-[0.18em] text-sky-100"
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
            className={badgeCls}
          >
            {`Prompt #${entry.promptNumber}`}
          </Badge>
        ) : null}
        <Badge
          variant="outline"
          className={badgeCls}
        >
          {promptSourceLabel(entry.promptSource)}
        </Badge>
        {stateLabel ? (
          <Badge
            variant="outline"
            className={badgeCls}
          >
            {stateLabel}
          </Badge>
        ) : null}
        <span className="text-white/65">
          {formatTime(entry.ts)}
        </span>
      </div>
      <pre className={
        "whitespace-pre-wrap break-words"
        + " font-mono text-[15px] leading-7"
        + " text-[#e0e0e0] subpixel-antialiased"
      }>
        {entry.prompt ?? "(empty prompt)"}
      </pre>
    </div>
  );
}

/* ResponseEntryRow is in response-row */
