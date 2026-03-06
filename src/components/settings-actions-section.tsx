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
  openrouterAgentId,
  formatOpenRouterAgentLabel,
  listUniqueOpenRouterAgentKeys,
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
  // Build OpenRouter virtual agent IDs from all configured agents
  const orAgentIds: string[] = openrouter.enabled
    ? listUniqueOpenRouterAgentKeys(openrouter.agents).map((key) => openrouterAgentId(key))
    : [];

  // Legacy support: keep OPENROUTER_SELECTED_AGENT_ID only while an action still references it.
  const selectedOpenRouterModel = getSelectedOpenRouterModel(openrouter);
  const hasLegacySelection = Object.values(actions).includes(
    OPENROUTER_SELECTED_AGENT_ID,
  );

  const baseOptionIds = Array.from(new Set([
    ...orAgentIds,
    ...Object.keys(agents),
  ]));

  const hasOptions = baseOptionIds.length > 0 || Boolean(
    hasLegacySelection && selectedOpenRouterModel,
  );

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
          const includeLegacyOption = Boolean(
            selectedOpenRouterModel &&
            actions[def.name] === OPENROUTER_SELECTED_AGENT_ID,
          );
          const optionIds = includeLegacyOption
            ? [OPENROUTER_SELECTED_AGENT_ID, ...baseOptionIds]
            : baseOptionIds;
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
                disabled={disabled || optionIds.length === 0}
              >
                <SelectTrigger className="w-[140px] shrink-0 border-primary/20 bg-background/80">
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
                    if (id.startsWith("openrouter:")) {
                      const key = id.slice("openrouter:".length);
                      const entry = openrouter.agents[key];
                      if (!entry) return null;
                      return (
                        <SelectItem key={id} value={id}>
                          {formatOpenRouterAgentLabel(key, entry.label, entry.model)}
                        </SelectItem>
                      );
                    }
                    return (
                      <SelectItem key={id} value={id}>
                        {agents[id]?.label ?? id}
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
