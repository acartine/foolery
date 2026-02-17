"use client";

import { Bot, Code2, Diamond, Lightbulb, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ResolvedAgentInfo } from "@/hooks/use-agent-info";

const VENDOR_ICONS: Record<string, { icon: typeof Bot; color: string }> = {
  claude: { icon: Sparkles, color: "text-purple-500" },
  codex: { icon: Code2, color: "text-green-600" },
  gemini: { icon: Diamond, color: "text-blue-500" },
};

const DEFAULT_VENDOR_ICON = { icon: Bot, color: "text-muted-foreground" };

interface AgentInfoLineProps {
  agent: ResolvedAgentInfo;
}

/**
 * Inline agent info display with vendor icon, name, model, command,
 * and a lightbulb tooltip pointing to Settings.
 */
export function AgentInfoLine({ agent }: AgentInfoLineProps) {
  const cfg = VENDOR_ICONS[agent.vendor] ?? DEFAULT_VENDOR_ICON;
  const Icon = cfg.icon;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className={`size-3.5 ${cfg.color}`} />
      <span className="font-medium">{agent.name}</span>
      {agent.model && (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span>{agent.model}</span>
        </>
      )}
      <span className="text-muted-foreground/40">|</span>
      <span className="font-mono text-[11px]">{agent.command}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Lightbulb className="ml-1 size-3.5 cursor-help text-amber-400" />
          </TooltipTrigger>
          <TooltipContent side="right">
            Configure in Settings
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
