"use client";

import { toast } from "sonner";
import {
  Zap,
  Clapperboard,
  Film,
  Layers,
  Droplets,
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
import type { ActionAgentMappings } from "@/lib/schemas";
import type { LucideIcon } from "lucide-react";

interface ActionsSectionProps {
  actions: ActionAgentMappings;
  agents: Record<string, RegisteredAgent>;
  onActionsChange: (actions: ActionAgentMappings) => void;
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
    description: "Execute a single bead",
    icon: Zap,
  },
  {
    name: "scene",
    label: "Scene!",
    description: "Multi-bead orchestration",
    icon: Clapperboard,
  },
  {
    name: "direct",
    label: "Direct",
    description: "Orchestration planning",
    icon: Film,
  },
  {
    name: "breakdown",
    label: "Breakdown",
    description: "Decompose into sub-beads",
    icon: Layers,
  },
  {
    name: "hydration",
    label: "Hydration",
    description: "Quick direct planning",
    icon: Droplets,
  },
];

export function SettingsActionsSection({
  actions,
  agents,
  onActionsChange,
}: ActionsSectionProps) {
  const agentIds = Object.keys(agents);

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
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Action Mappings</h3>
      <p className="text-xs text-muted-foreground">
        Choose which registered agent handles each action.
      </p>
      <div className="space-y-3">
        {ACTION_DEFS.map((def) => {
          const Icon = def.icon;
          return (
            <div
              key={def.name}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <Label className="text-sm">{def.label}</Label>
                  <p className="text-[11px] text-muted-foreground">
                    {def.description}
                  </p>
                </div>
              </div>
              <Select
                value={actions[def.name] || ""}
                onValueChange={(v) => handleChange(def.name, v)}
                disabled={agentIds.length === 0}
              >
                <SelectTrigger className="w-[140px] shrink-0">
                  <SelectValue placeholder={agentIds.length === 0 ? "no agents" : "select agent"} />
                </SelectTrigger>
                <SelectContent>
                  {agentIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {agents[id].label ?? id}
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
