"use client";

import { Bot } from "lucide-react";
import type {
  AgentHistoryEntry,
  AgentHistoryInteractionType,
} from "@/lib/agent-history-types";
import { Badge } from "@/components/ui/badge";
import {
  clipDisplay,
  formatTime,
  interactionTypeLabel,
  interactionTypeTone,
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
}: {
  entry: AgentHistoryEntry;
  agentLabel?: string;
  interactionType?: AgentHistoryInteractionType;
  precedingPrompt?: PromptContext;
}) {
  const raw = entry.raw ?? "";
  const summary = summarizeResponse(raw);
  const showRaw =
    raw.trim().length > 0
    && summary.trim() !== raw.trim();

  return (
    <div className={
      "rounded border border-white/10"
      + " bg-[#16162a] px-3 py-2"
      + " shadow-[inset_0_1px_0_"
      + "rgba(255,255,255,0.03)]"
    }>
      <ResponseEntryHeader
        agentLabel={agentLabel}
        interactionType={interactionType}
        precedingPrompt={precedingPrompt}
        ts={entry.ts}
      />
      <pre className={
        "whitespace-pre-wrap break-words"
        + " font-mono text-[15px] leading-7"
        + " text-[#e0e0e0]"
        + " subpixel-antialiased"
      }>
        {summary || "(empty response)"}
      </pre>
      {showRaw ? (
        <RawEventDetails raw={raw} />
      ) : null}
    </div>
  );
}

function ResponseEntryHeader({
  agentLabel,
  interactionType,
  precedingPrompt,
  ts,
}: {
  agentLabel?: string;
  interactionType?: AgentHistoryInteractionType;
  precedingPrompt?: PromptContext;
  ts?: string;
}) {
  const metaBadgeCls =
    "border-white/10 bg-white/5"
    + " text-[13px] font-normal"
    + " text-[#e0e0e0]";
  return (
    <div className={
      "mb-1.5 flex flex-wrap items-center"
      + " gap-2 font-mono text-[14px]"
      + " leading-6 text-[#e0e0e0]"
      + " subpixel-antialiased"
    }>
      <Bot className="size-5 text-white/80" />
      <span className={
        "font-semibold uppercase"
        + " tracking-[0.18em] text-[#e0e0e0]"
      }>
        Agent
        {agentLabel
          ? ` · ${agentLabel}`
          : ""}
        {" "}-&gt; App
      </span>
      {interactionType ? (
        <Badge
          variant="outline"
          className={
            "text-[13px] font-normal "
            + interactionTypeTone(
              interactionType,
            )
          }
        >
          {interactionTypeLabel(
            interactionType,
          )}
        </Badge>
      ) : null}
      {typeof precedingPrompt?.promptNumber
        === "number" ? (
        <Badge
          variant="outline"
          className={metaBadgeCls}
        >
          {`Prompt #${
            precedingPrompt.promptNumber
          }`}
        </Badge>
      ) : null}
      {precedingPrompt?.source ? (
        <Badge
          variant="outline"
          className={metaBadgeCls}
        >
          {promptSourceLabel(
            precedingPrompt.source,
          )}
        </Badge>
      ) : null}
      {precedingPrompt?.workflowState ? (
        <Badge
          variant="outline"
          className={metaBadgeCls}
        >
          {workflowStateBadgeLabel(
            precedingPrompt.workflowState,
          )}
        </Badge>
      ) : null}
      <span className="text-white/65">
        {formatTime(ts)}
      </span>
    </div>
  );
}

function RawEventDetails(
  { raw }: { raw: string },
) {
  return (
    <details className={
      "mt-2 rounded border border-white/10"
      + " bg-[#101522] px-2.5 py-2"
      + " text-[14px] font-mono"
      + " text-[#e0e0e0] subpixel-antialiased"
    }>
      <summary className={
        "cursor-pointer text-white/75"
      }>
        Raw event
      </summary>
      <pre className={
        "mt-1.5 whitespace-pre-wrap break-words"
        + " font-mono text-[14px] leading-6"
        + " text-[#e0e0e0]"
      }>
        {clipDisplay(raw, 16_000)}
      </pre>
    </details>
  );
}
