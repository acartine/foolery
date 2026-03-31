"use client";

import {
  Bot,
  Code2,
  Diamond,
  Sparkles,
  Clock,
  Timer,
} from "lucide-react";
import type {
  ResolvedAgentInfo,
} from "@/hooks/use-agent-info";
import {
  useElapsedTime,
} from "@/hooks/use-elapsed-time";
import {
  formatAgentDisplayLabel,
} from "@/lib/agent-identity";
import {
  resolveTerminalElapsedAnchor,
} from "@/lib/terminal-time-anchor";

interface VendorTheme {
  icon: typeof Bot;
  color: string;
  bg: string;
}

function vendorTheme(
  vendor: string,
  light: boolean,
): VendorTheme {
  if (vendor === "claude") {
    return {
      icon: Sparkles,
      color: light
        ? "text-purple-800"
        : "text-purple-300",
      bg: light
        ? "bg-purple-50"
        : "bg-purple-500/10",
    };
  }
  if (vendor === "codex") {
    return {
      icon: Code2,
      color: light
        ? "text-green-800"
        : "text-green-300",
      bg: light
        ? "bg-green-50"
        : "bg-green-500/10",
    };
  }
  if (vendor === "gemini") {
    return {
      icon: Diamond,
      color: light
        ? "text-blue-800"
        : "text-blue-300",
      bg: light
        ? "bg-blue-50"
        : "bg-blue-500/10",
    };
  }
  return {
    icon: Bot,
    color: light
      ? "text-slate-700"
      : "text-slate-300",
    bg: light
      ? "bg-slate-50"
      : "bg-slate-500/10",
  };
}

function stateBarColor(
  state: string,
  light: boolean,
): string {
  const s = state.trim().toLowerCase();
  if (s === "shipped") {
    return light
      ? "bg-green-100 text-green-900"
      : "bg-green-500/20 text-green-300";
  }
  if (
    s === "abandoned"
    || s === "closed"
    || s === "deferred"
  ) {
    return light
      ? "bg-gray-100 text-gray-800"
      : "bg-gray-500/20 text-gray-400";
  }
  if (s === "blocked") {
    return light
      ? "bg-red-100 text-red-900"
      : "bg-red-500/20 text-red-300";
  }
  if (s.endsWith("_review")) {
    return light
      ? "bg-purple-100 text-purple-900"
      : "bg-purple-500/20 text-purple-300";
  }
  if (s.startsWith("ready_for_")) {
    return light
      ? "bg-blue-100 text-blue-900"
      : "bg-blue-500/20 text-blue-300";
  }
  return light
    ? "bg-yellow-100 text-yellow-900"
    : "bg-yellow-500/20 text-yellow-300";
}

function formatState(state: string): string {
  const abbr: Record<string, string> = {
    Implementation: "Impl",
  };
  return (state ?? "open")
    .split("_")
    .map((w) => {
      const c =
        w.charAt(0).toUpperCase() + w.slice(1);
      return abbr[c] ?? c;
    })
    .join(" ");
}

export interface BeatInfoForBar {
  state: string;
  stateChangedAt: string;
  createdAt: string;
  latestTakeStartedAt?: string;
}

interface AgentInfoBarProps {
  agent: ResolvedAgentInfo;
  beat?: BeatInfoForBar | null;
  lightTheme: boolean;
}

export function AgentInfoBar({
  agent,
  beat,
  lightTheme,
}: AgentInfoBarProps) {
  const cfg = vendorTheme(
    agent.vendor,
    lightTheme,
  );
  const Icon = cfg.icon;
  const agentLabel =
    formatAgentDisplayLabel(agent)
    || agent.name;

  const stateElapsed = useElapsedTime(
    beat?.stateChangedAt,
  );
  const totalElapsed = useElapsedTime(
    resolveTerminalElapsedAnchor(beat),
  );

  const borderCls = lightTheme
    ? "border-b border-slate-200"
    : "border-b border-white/5";
  const timerPrimary = lightTheme
    ? "text-sky-800"
    : "text-cyan-300/80";
  const timerIcon = lightTheme
    ? "text-sky-700"
    : "text-cyan-400/60";
  const timerSecondary = lightTheme
    ? "text-slate-600"
    : "text-white/50";
  const timerSecondaryIcon = lightTheme
    ? "text-slate-500"
    : "text-white/30";
  const separator = lightTheme
    ? "text-slate-400"
    : "text-white/20";

  return (
    <div className={
      "flex items-center gap-2 px-3"
      + ` py-1 text-[11px] ${borderCls}`
      + ` ${cfg.bg}`
    }>
      {beat && (
        <>
          <span className={
            "inline-flex items-center"
            + " rounded px-1.5 py-0.5"
            + " text-[10px] font-semibold"
            + " uppercase tracking-wide "
            + stateBarColor(
              beat.state,
              lightTheme,
            )
          }>
            {formatState(beat.state)}
          </span>
          <span
            className={
              "inline-flex items-center"
              + ` gap-1 font-mono ${timerPrimary}`
            }
            title="Time in current state"
          >
            <Clock className={
              "size-3 " + timerIcon
            } />
            {stateElapsed}
          </span>
          <span
            className={
              "inline-flex items-center"
              + " gap-1 font-mono "
              + timerSecondary
            }
            title="Total elapsed time"
          >
            <Timer className={
              "size-3 " + timerSecondaryIcon
            } />
            {totalElapsed}
          </span>
          <span className={separator}>|</span>
        </>
      )}
      <Icon className={
        "size-3.5 " + cfg.color
      } />
      <span className={
        "font-medium " + cfg.color
      }>
        {agentLabel}
      </span>
    </div>
  );
}
