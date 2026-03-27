"use client";

import { Loader2 } from "lucide-react";
import {
  formatModelDisplay,
} from "@/hooks/use-agent-info";
import { resolveStep } from "@/lib/workflows";

export const WINDOW_SIZE = 5;
export const TITLE_ROW_HEIGHT_PX = 48;
export const TOP_PANEL_HEADER_HEIGHT_PX = 62;
export const TOP_PANEL_HEIGHT_PX =
  WINDOW_SIZE * TITLE_ROW_HEIGHT_PX
  + TOP_PANEL_HEADER_HEIGHT_PX;
export const CACHE_MAX = 10;

export function Spinner(
  { className = "" }: { className?: string },
) {
  return (
    <Loader2
      className={`animate-spin ${className}`}
    />
  );
}

export function beatKey(
  beatId: string,
  repoPath: string,
): string {
  return `${repoPath}::${beatId}`;
}

export function parseBeatKey(
  value: string | null,
): { beatId: string; repoPath: string } | null {
  if (!value) return null;
  const pivot = value.lastIndexOf("::");
  if (pivot <= 0) return null;
  const repoPath = value.slice(0, pivot);
  const beatId = value.slice(pivot + 2);
  if (!repoPath || !beatId) return null;
  return { beatId, repoPath };
}

export function parseMillis(
  value: string,
): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function formatTime(
  value: string | undefined,
): string {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function relativeTime(
  value: string,
): string {
  const now = Date.now();
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return value;
  const diff = now - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) {
    return `${Math.floor(diff / minute)}m ago`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)}h ago`;
  }
  return `${Math.floor(diff / day)}d ago`;
}

export function promptSourceLabel(
  source?: string,
): string {
  if (!source) return "Prompt";
  if (source === "initial") {
    return "Initial prompt";
  }
  if (source === "execution_follow_up") {
    return "Execution follow-up";
  }
  if (source === "ship_completion_follow_up") {
    return "Ship follow-up";
  }
  if (source === "scene_completion_follow_up") {
    return "Scene follow-up";
  }
  if (source === "auto_ask_user_response") {
    return "Auto AskUser response";
  }
  return source.replace(/_/g, " ");
}

function workflowStepLabelFromState(
  state?: string,
): string | null {
  if (!state) return null;
  const resolved = resolveStep(state);
  if (!resolved) return null;
  return resolved.step
    .split("_")
    .map(
      (p) => p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(" ");
}

export function workflowStateBadgeLabel(
  state?: string,
): string | null {
  if (!state) return null;
  const stepLabel =
    workflowStepLabelFromState(state);
  return stepLabel
    ? `${stepLabel} · ${state}`
    : state;
}

export function stripIdPrefix(
  id: string,
): string {
  const idx = id.lastIndexOf("-");
  return idx > 0 ? id.slice(idx + 1) : id;
}

export function clipDisplay(
  text: string,
  maxChars = 8_000,
): string {
  if (text.length <= maxChars) return text;
  const extra = text.length - maxChars;
  return (
    `${text.slice(0, maxChars)}`
    + `\n... [truncated ${extra} chars]`
  );
}

export function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

export function summarizeResponse(
  raw: string,
): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return clipDisplay(raw);
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<
      string,
      unknown
    >;
    const type =
      typeof parsed.type === "string"
        ? parsed.type
        : "";

    if (type === "assistant") {
      const summary = summarizeAssistant(parsed);
      if (summary) return clipDisplay(summary);
    }

    if (type === "user") {
      const summary = summarizeUser(parsed);
      if (summary) return clipDisplay(summary);
    }

    if (type === "result") {
      return summarizeResult(parsed);
    }

    if (type === "system") {
      return summarizeSystem(parsed);
    }

    return clipDisplay(
      JSON.stringify(parsed, null, 2),
    );
  } catch {
    return clipDisplay(raw);
  }
}

function summarizeAssistant(
  obj: Record<string, unknown>,
): string | null {
  const message = toObject(obj.message);
  const content = Array.isArray(message?.content)
    ? message.content
    : null;
  if (!content) return null;

  const parts: string[] = [];
  for (const rawBlock of content) {
    const block = toObject(rawBlock);
    if (!block) continue;
    if (
      block.type === "text"
      && typeof block.text === "string"
    ) {
      const text = block.text.trim();
      if (text) parts.push(text);
      continue;
    }
    if (block.type === "tool_use") {
      const name =
        typeof block.name === "string"
          ? block.name
          : "tool";
      const input = toObject(block.input);
      let summary = "";
      if (typeof input?.command === "string") {
        summary = ` ${input.command}`;
      } else if (
        typeof input?.description === "string"
      ) {
        summary = ` ${input.description}`;
      } else if (
        typeof input?.file_path === "string"
      ) {
        summary = ` ${input.file_path}`;
      }
      parts.push(
        `▶ ${name}${summary}`.trim(),
      );
    }
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

function summarizeUser(
  obj: Record<string, unknown>,
): string | null {
  const message = toObject(obj.message);
  const content = Array.isArray(message?.content)
    ? message.content
    : null;
  if (!content) return null;

  for (const rawBlock of content) {
    const block = toObject(rawBlock);
    if (!block) continue;
    if (block.type === "tool_result") {
      const rawContent = block.content;
      if (typeof rawContent === "string") {
        return rawContent;
      }
      return JSON.stringify(rawContent);
    }
    if (
      block.type === "text"
      && typeof block.text === "string"
    ) {
      return block.text;
    }
  }

  return null;
}

function summarizeResult(
  parsed: Record<string, unknown>,
): string {
  const resultText =
    typeof parsed.result === "string"
      ? parsed.result
      : "(no result text)";
  const cost =
    typeof parsed.cost_usd === "number"
      ? `$${parsed.cost_usd.toFixed(4)}`
      : null;
  const duration =
    typeof parsed.duration_ms === "number"
      ? `${(parsed.duration_ms / 1000)
        .toFixed(1)}s`
      : null;
  const meta = [cost, duration]
    .filter(Boolean)
    .join(", ");
  return clipDisplay(
    meta ? `${resultText}\n(${meta})` : resultText,
  );
}

function summarizeSystem(
  parsed: Record<string, unknown>,
): string {
  const subtype =
    typeof parsed.subtype === "string"
      ? parsed.subtype
      : "event";
  const hookName =
    typeof parsed.hook_name === "string"
      ? parsed.hook_name
      : null;
  const outcome =
    typeof parsed.outcome === "string"
      ? parsed.outcome
      : null;
  const extra = [hookName, outcome]
    .filter(Boolean)
    .join(" · ");
  return clipDisplay(
    extra
      ? `system:${subtype} · ${extra}`
      : `system:${subtype}`,
  );
}

export function statusTone(
  status?: string,
): string {
  if (status === "completed") {
    return "border-emerald-400/50"
      + " bg-emerald-500/20 text-emerald-100";
  }
  if (status === "error") {
    return "border-red-400/50"
      + " bg-red-500/20 text-red-100";
  }
  if (status === "aborted") {
    return "border-amber-400/50"
      + " bg-amber-500/20 text-amber-100";
  }
  if (status === "running") {
    return "border-sky-400/50"
      + " bg-sky-500/20 text-sky-100";
  }
  return "border-slate-500"
    + " bg-slate-800/90 text-slate-100";
}

export function interactionTypeTone(
  iType: string,
): string {
  if (iType === "scene") {
    return "border-violet-500/40"
      + " bg-violet-500/20 text-violet-100";
  }
  if (iType === "direct") {
    return "border-emerald-500/40"
      + " bg-emerald-500/20 text-emerald-100";
  }
  if (iType === "breakdown") {
    return "border-rose-500/40"
      + " bg-rose-500/20 text-rose-100";
  }
  return "border-cyan-500/40"
    + " bg-cyan-500/20 text-cyan-100";
}

export function interactionTypeLabel(
  iType: string,
): string {
  if (iType === "scene") return "Scene!";
  if (iType === "direct") return "Planning";
  if (iType === "breakdown") return "Breakdown";
  return "Take!";
}

export function buildAgentLabel(
  agentName?: string,
  agentModel?: string,
  agentVersion?: string,
): string | undefined {
  const parts: string[] = [];
  if (agentName) parts.push(agentName);
  const modelDisplay = formatModelDisplay(
    agentModel,
  );
  if (modelDisplay) {
    parts.push(
      agentVersion
        ? `${modelDisplay} ${agentVersion}`
        : modelDisplay,
    );
  } else if (agentVersion) {
    parts.push(agentVersion);
  }
  return parts.length > 0
    ? parts.join(" · ")
    : undefined;
}
