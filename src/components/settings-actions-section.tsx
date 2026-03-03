"use client";

import { toast } from "sonner";
import {
  Zap,
  Clapperboard,
  Layers,
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
import type { ActionAgentMappings, OpenRouterSettings } from "@/lib/schemas";
import {
  OPENROUTER_SELECTED_AGENT_ID,
  formatOpenRouterSelectedAgentLabel,
  getSelectedOpenRouterModel,
} from "@/lib/openrouter";
import type { LucideIcon } from "lucide-react";

interface ActionsSectionProps {
  actions: ActionAgentMappings;
  agents: Record<string, RegisteredAgent>;
  openrouter: OpenRouterSettings;
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
    name: "breakdown",
    label: "Breakdown",
    description: "Decompose into sub-beats",
    icon: Layers,
  },
];

export function SettingsActionsSection({
  actions,
  agents,
  openrouter,
  onActionsChange,
  disabled,
}: ActionsSectionProps) {
  const selectedOpenRouterModel = getSelectedOpenRouterModel(openrouter);
  const actionUsesOpenRouter = Object.values(actions).includes(
    OPENROUTER_SELECTED_AGENT_ID,
  );
  const includeOpenRouterOption =
    (selectedOpenRouterModel && openrouter.enabled) ||
    (selectedOpenRouterModel && actionUsesOpenRouter);

  const optionIds = Array.from(new Set([
    ...(includeOpenRouterOption ? [OPENROUTER_SELECTED_AGENT_ID] : []),
    ...Object.keys(agents),
  ]));

  const hasOptions = optionIds.length > 0;

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
    <div className={disabled ? "space-y-4 opacity-50 pointer-events-none" : "space-y-4"}>
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
                disabled={disabled || !hasOptions}
              >
                <SelectTrigger className="w-[140px] shrink-0">
                  <SelectValue placeholder={hasOptions ? "select agent" : "no agents"} />
                </SelectTrigger>
                <SelectContent>
                  {optionIds.map((id) => {
                    if (id === OPENROUTER_SELECTED_AGENT_ID) {
                      return (
                        <SelectItem key={id} value={id}>
                          {formatOpenRouterSelectedAgentLabel(
                            selectedOpenRouterModel!,
                          )}
                        </SelectItem>
                      );
                    }
                    return (
                      <SelectItem key={id} value={id}>
                        {agents[id].label ?? id}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
