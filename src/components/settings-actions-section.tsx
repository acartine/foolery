"use client";

import { toast } from "sonner";
import {
  Zap,
  Clapperboard,
  Sparkles,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveActions } from "@/lib/settings-api";
import type { RegisteredAgent, ActionName } from "@/lib/types";
import { AgentDisplayLabel } from "@/components/agent-display-label";
import type { ActionAgentMappings } from "@/lib/schemas";
import type { LucideIcon } from "lucide-react";

interface ActionsSectionProps {
  actions: ActionAgentMappings;
  agents: Record<string, RegisteredAgent>;
  onActionsChange: (actions: ActionAgentMappings) => void;
  disabled?: boolean;
}

interface ActionDef {
  name: ActionName;
  label: string;
  description: string;
  icon: LucideIcon;
}

const ACTION_DEFS: ActionDef[] = [
  {
    name: "take",
    label: "Take!",
    description: "Execute a single beat",
    icon: Zap,
  },
  {
    name: "scene",
    label: "Scene!",
    description: "Multi-beat orchestration",
    icon: Clapperboard,
  },
  {
    name: "scopeRefinement",
    label: "Scope Refinement",
    description: "Refine new beats after creation",
    icon: Sparkles,
  },
];

export function SettingsActionsSection({
  actions,
  agents,
  onActionsChange,
  disabled,
}: ActionsSectionProps) {
  const agentIds = Object.keys(agents);
  const hasOptions = agentIds.length > 0;

  async function handleChange(action: ActionName, value: string) {
    const updated = { ...actions, [action]: value };
    onActionsChange(updated);
    try {
      const res = await saveActions({ [action]: value });
      if (!res.ok) {
        toast.error(res.error ?? "Failed to save action mapping");
      }
    } catch {
      toast.error("Failed to save action mapping");
    }
  }

  return (
    <div className={disabled ? "space-y-3 opacity-50 pointer-events-none" : "space-y-3"}>
      <h3 className="text-xs font-medium">Action Mappings</h3>
      <p className="text-[11px] text-muted-foreground">
        Choose which registered agent handles each action.
      </p>
      <div className="space-y-2">
        {ACTION_DEFS.map((def) => {
          const Icon = def.icon;
          return (
            <div
              key={def.name}
              className="flex items-center justify-between rounded-xl border border-primary/15 bg-background/60 px-3 py-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="size-3.5 text-primary shrink-0" />
                <div className="min-w-0">
                  <Label className="text-xs">{def.label}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {def.description}
                  </p>
                </div>
              </div>
              <Select
                value={actions[def.name] || ""}
                onValueChange={(v) => handleChange(def.name, v)}
                disabled={disabled || agentIds.length === 0}
              >
                <SelectTrigger className="w-[240px] shrink-0 border-primary/20 bg-background/80">
                  <SelectValue placeholder={hasOptions ? "select agent" : "no agents"} />
                </SelectTrigger>
                <SelectContent>
                  {agentIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {agents[id] ? <AgentDisplayLabel agent={agents[id]!} /> : id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
