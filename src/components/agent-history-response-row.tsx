"use client";

import { Bot } from "lucide-react";
import type {
  AgentHistoryEntry,
  AgentHistoryInteractionType,
} from "@/lib/agent-history-types";
import { Badge } from "@/components/ui/badge";
import type {
  ConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";
import {
  clipDisplay,
  formatTime,
  promptSourceLabel,
  summarizeResponse,
  workflowStateBadgeLabel,
} from "./agent-history-utils";
import type {
  PromptContext,
} from "./agent-history-session-card";

export function ResponseEntryRow({
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
  const raw = entry.raw ?? "";
  const summary = summarizeResponse(raw);
  const showRaw =
    raw.trim().length > 0
    && summary.trim() !== raw.trim();

  return (
    <div className={theme.responseContainer}>
      <ResponseEntryHeader
        agentLabel={agentLabel}
        interactionType={interactionType}
        precedingPrompt={precedingPrompt}
        ts={entry.ts}
        theme={theme}
      />
      <pre className={theme.responseBody}>
        {summary || "(empty response)"}
      </pre>
      {showRaw ? (
        <RawEventDetails
          raw={raw}
          theme={theme}
        />
      ) : null}
    </div>
  );
}

function ResponseEntryHeader({
  agentLabel,
  interactionType,
  precedingPrompt,
  ts,
  theme,
}: {
  agentLabel?: string;
  interactionType?: AgentHistoryInteractionType;
  precedingPrompt?: PromptContext;
  ts?: string;
  theme: ConversationLogTheme;
}) {
  const iLabel = interactionType
    ? interactionLabel(interactionType)
    : null;
  const iTypeTone = interactionType
    ? interactionBadgeTone(
        interactionType,
        theme,
      )
    : null;
  return (
    <div className={theme.responseHeader}>
      <Bot className={
        "size-5 " + theme.responseIcon
      } />
      <span className={
        theme.responseDirectionLabel
      }>
        Agent
        {agentLabel
          ? ` · ${agentLabel}`
          : ""}
        {" "}-&gt; App
      </span>
      {iLabel && iTypeTone ? (
        <Badge
          variant="outline"
          className={
            "text-[13px] font-normal "
            + iTypeTone
          }
        >
          {iLabel}
        </Badge>
      ) : null}
      {typeof precedingPrompt?.promptNumber
        === "number" ? (
        <Badge
          variant="outline"
          className={theme.responseMetaBadge}
        >
          {`Prompt #${
            precedingPrompt.promptNumber
          }`}
        </Badge>
      ) : null}
      {precedingPrompt?.source ? (
        <Badge
          variant="outline"
          className={theme.responseMetaBadge}
        >
          {promptSourceLabel(
            precedingPrompt.source,
          )}
        </Badge>
      ) : null}
      {precedingPrompt?.workflowState ? (
        <Badge
          variant="outline"
          className={theme.responseMetaBadge}
        >
          {workflowStateBadgeLabel(
            precedingPrompt.workflowState,
          )}
        </Badge>
      ) : null}
      <span className={theme.cardMuted}>
        {formatTime(ts)}
      </span>
    </div>
  );
}

function RawEventDetails({
  raw,
  theme,
}: {
  raw: string;
  theme: ConversationLogTheme;
}) {
  return (
    <details className={theme.rawContainer}>
      <summary className={theme.rawSummary}>
        Raw event
      </summary>
      <pre className={theme.rawBody}>
        {clipDisplay(raw, 16_000)}
      </pre>
    </details>
  );
}

/* local helpers */

function interactionLabel(
  iType: string,
): string {
  if (iType === "scene") return "scene";
  if (iType === "direct") return "direct";
  if (iType === "breakdown") return "breakdown";
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
  if (iType === "breakdown")
    return theme.badgeInteractionBreakdown;
  return theme.badgeInteractionDefault;
}
