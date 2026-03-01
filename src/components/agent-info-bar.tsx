"use client";

import { Bot, Code2, Diamond, Globe, Sparkles } from "lucide-react";
import type { ResolvedAgentInfo } from "@/hooks/use-agent-info";

const VENDOR_CONFIG: Record<
  string,
  { icon: typeof Bot; color: string; bg: string }
> = {
  claude: {
    icon: Sparkles,
    color: "text-purple-300",
    bg: "bg-purple-500/10",
  },
  codex: {
    icon: Code2,
    color: "text-green-300",
    bg: "bg-green-500/10",
  },
  gemini: {
    icon: Diamond,
    color: "text-blue-300",
    bg: "bg-blue-500/10",
  },
  openrouter: {
    icon: Globe,
    color: "text-orange-300",
    bg: "bg-orange-500/10",
  },
};

const DEFAULT_VENDOR = {
  icon: Bot,
  color: "text-slate-300",
  bg: "bg-slate-500/10",
} as const;

interface AgentInfoBarProps {
  agent: ResolvedAgentInfo;
}

/**
 * Thin horizontal bar showing agent icon, name, model, and command path.
 * Designed for placement between the terminal tab bar and the xterm container.
 */
export function AgentInfoBar({ agent }: AgentInfoBarProps) {
  const cfg = VENDOR_CONFIG[agent.vendor] ?? DEFAULT_VENDOR;
  const Icon = cfg.icon;

  return (
    <div
      className={`flex items-center gap-2 border-b border-white/5 px-3 py-1 text-[11px] ${cfg.bg}`}
    >
      <Icon className={`size-3.5 ${cfg.color}`} />
      <span className={`font-medium ${cfg.color}`}>{agent.name}</span>
      {agent.model && (
        <>
          <span className="text-white/20">|</span>
          <span className="text-white/50">{agent.model}</span>
        </>
      )}
      <span className="text-white/20">|</span>
      <span className="truncate font-mono text-white/40">{agent.command}</span>
    </div>
  );
}
