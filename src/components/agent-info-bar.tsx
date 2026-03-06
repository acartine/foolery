"use client";

import { Bot, Code2, Diamond, Sparkles, Clock, Timer } from "lucide-react";
import type { ResolvedAgentInfo } from "@/hooks/use-agent-info";
import { useElapsedTime } from "@/hooks/use-elapsed-time";
import { formatAgentDisplayLabel } from "@/lib/agent-identity";
import { resolveTerminalElapsedAnchor } from "@/lib/terminal-time-anchor";

const VENDOR_CONFIG: Record<
  string,
  { icon: typeof Bot; color: string; bg: string }
> = {
  claude: {
    icon: Sparkles,
    color: "text-purple-300",
    bg: "bg-purple-500/10",
  },
  openai: {
    icon: Code2,
    color: "text-green-300",
    bg: "bg-green-500/10",
  },
  gemini: {
    icon: Diamond,
    color: "text-blue-300",
    bg: "bg-blue-500/10",
  },
};

const DEFAULT_VENDOR = {
  icon: Bot,
  color: "text-slate-300",
  bg: "bg-slate-500/10",
} as const;

/** Color for the beat state pill in the info bar. */
function stateBarColor(state: string): string {
  const s = state.trim().toLowerCase();
  if (s === "shipped") return "bg-green-500/20 text-green-300";
  if (s === "abandoned" || s === "closed") return "bg-gray-500/20 text-gray-400";
  if (s === "deferred") return "bg-gray-500/20 text-gray-400";
  if (s === "blocked") return "bg-red-500/20 text-red-300";
  if (s.endsWith("_review")) return "bg-purple-500/20 text-purple-300";
  if (s.startsWith("ready_for_")) return "bg-blue-500/20 text-blue-300";
  return "bg-yellow-500/20 text-yellow-300";
}

function formatState(state: string): string {
  const abbreviations: Record<string, string> = {
    Implementation: "Impl",
  };
  return (state ?? "open")
    .split("_")
    .map((w) => {
      const capped = w.charAt(0).toUpperCase() + w.slice(1);
      return abbreviations[capped] ?? capped;
    })
    .join(" ");
}

export interface BeatInfoForBar {
  state: string;
  /** ISO timestamp of when the beat entered the current state (beat.updated). */
  stateChangedAt: string;
  /** ISO timestamp of when the beat was created (beat.created). */
  createdAt: string;
  /** ISO timestamp of the latest Take! execution for the beat. */
  latestTakeStartedAt?: string;
}

interface AgentInfoBarProps {
  agent: ResolvedAgentInfo;
  beat?: BeatInfoForBar | null;
}

/**
 * Thin horizontal bar showing beat state, elapsed timers, and agent info.
 * Placed between the terminal tab bar and the xterm container.
 */
export function AgentInfoBar({ agent, beat }: AgentInfoBarProps) {
  const cfg = VENDOR_CONFIG[agent.vendor] ?? DEFAULT_VENDOR;
  const Icon = cfg.icon;
  const agentLabel = formatAgentDisplayLabel(agent) || agent.name;

  const stateElapsed = useElapsedTime(beat?.stateChangedAt);
  const totalElapsed = useElapsedTime(resolveTerminalElapsedAnchor(beat));

  return (
    <div
      className={`flex items-center gap-2 border-b border-white/5 px-3 py-1 text-[11px] ${cfg.bg}`}
    >
      {/* Beat state section */}
      {beat && (
        <>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateBarColor(beat.state)}`}
          >
            {formatState(beat.state)}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-cyan-300/80" title="Time in current state">
            <Clock className="size-3 text-cyan-400/60" />
            {stateElapsed}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-white/50" title="Total elapsed time">
            <Timer className="size-3 text-white/30" />
            {totalElapsed}
          </span>
          <span className="text-white/20">|</span>
        </>
      )}

      {/* Agent info section */}
      <Icon className={`size-3.5 ${cfg.color}`} />
      <span className={`font-medium ${cfg.color}`}>{agentLabel}</span>
    </div>
  );
}
