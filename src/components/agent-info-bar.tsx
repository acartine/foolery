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
        ? "text-clay-800"
        : "text-clay-300",
      bg: light
        ? "bg-clay-50"
        : "bg-clay-500/10",
    };
  }
  if (vendor === "codex") {
    return {
      icon: Code2,
      color: light
        ? "text-moss-700"
        : "text-moss-200",
      bg: light
        ? "bg-moss-100"
        : "bg-moss-500/10",
    };
  }
  if (vendor === "gemini") {
    return {
      icon: Diamond,
      color: light
        ? "text-lake-700"
        : "text-lake-400",
      bg: light
        ? "bg-lake-100"
        : "bg-lake-500/10",
    };
  }
  return {
    icon: Bot,
    color: light
      ? "text-ink-700"
      : "text-paper-300",
    bg: light
      ? "bg-paper-50"
      : "bg-paper-500/10",
  };
}

function stateBarColor(
  state: string,
  light: boolean,
): string {
  const s = state.trim().toLowerCase();
  if (s === "shipped") {
    return light
      ? "bg-moss-100 text-moss-700"
      : "bg-moss-500/20 text-moss-200";
  }
  if (
    s === "abandoned"
    || s === "closed"
    || s === "deferred"
  ) {
    return light
      ? "bg-paper-100 text-ink-800"
      : "bg-paper-500/20 text-paper-400";
  }
  if (s === "blocked") {
    return light
      ? "bg-rust-100 text-rust-700"
      : "bg-rust-500/20 text-rust-400";
  }
  if (s.endsWith("_review")) {
    return light
      ? "bg-clay-100 text-clay-800"
      : "bg-clay-500/20 text-clay-300";
  }
  if (s.startsWith("ready_for_")) {
    return light
      ? "bg-lake-100 text-lake-700"
      : "bg-lake-500/20 text-lake-400";
  }
  return light
    ? "bg-ochre-100 text-ochre-700"
    : "bg-ochre-500/20 text-ochre-400";
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
    ? "border-b border-paper-200"
    : "border-b border-white/5";
  const timerPrimary = lightTheme
    ? "text-lake-700"
    : "text-molecule-400/80";
  const timerIcon = lightTheme
    ? "text-lake-700"
    : "text-molecule-400/60";
  const timerSecondary = lightTheme
    ? "text-ink-600"
    : "text-white/50";
  const timerSecondaryIcon = lightTheme
    ? "text-ink-500"
    : "text-white/30";
  const separator = lightTheme
    ? "text-paper-400"
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
