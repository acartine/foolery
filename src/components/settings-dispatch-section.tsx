"use client";

import { toast } from "sonner";
import { Zap, Users, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsActionsSection } from "@/components/settings-actions-section";
import { SettingsPoolsSection } from "@/components/settings-pools-section";
import { patchSettings } from "@/lib/settings-api";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  PoolsSettings,
  DispatchMode,
  OpenRouterSettings,
} from "@/lib/schemas";

interface DispatchSectionProps {
  dispatchMode: DispatchMode;
  actions: ActionAgentMappings;
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  openrouter: OpenRouterSettings;
  onDispatchModeChange: (mode: DispatchMode) => void;
  onActionsChange: (actions: ActionAgentMappings) => void;
  onPoolsChange: (pools: PoolsSettings) => void;
}

const MODES: {
  value: DispatchMode;
  label: string;
  description: string;
  icon: typeof Zap;
}[] = [
  {
    value: "actions",
    label: "Simple",
    description: "One agent per action",
    icon: Zap,
  },
  {
    value: "pools",
    label: "Advanced",
    description: "Weighted pools per step",
    icon: Users,
  },
];

export function SettingsDispatchSection({
  dispatchMode,
  actions,
  pools,
  agents,
  openrouter,
  onDispatchModeChange,
  onActionsChange,
  onPoolsChange,
}: DispatchSectionProps) {
  async function handleModeChange(mode: DispatchMode) {
    onDispatchModeChange(mode);
    try {
      const res = await patchSettings({ dispatchMode: mode });
      if (!res.ok) {
        toast.error(res.error ?? "Failed to save dispatch mode");
      }
    } catch {
      toast.error("Failed to save dispatch mode");
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Agent Dispatch</h3>
      <p className="text-xs text-muted-foreground">
        Choose how agents are assigned to workflow actions. Only the active
        mode is used at runtime.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = dispatchMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => handleModeChange(mode.value)}
              className={cn(
                "relative flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-muted hover:border-muted-foreground/25 hover:bg-muted/50",
              )}
            >
              {active && (
                <div className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-primary">
                  <Check className="size-2.5 text-primary-foreground" />
                </div>
              )}
              <Icon
                className={cn(
                  "size-4",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-sm font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {mode.label}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {mode.description}
              </span>
            </button>
          );
        })}
      </div>

      {dispatchMode === "actions" ? (
        <>
          <SettingsActionsSection
            actions={actions}
            agents={agents}
            openrouter={openrouter}
            onActionsChange={onActionsChange}
          />
        </>
      ) : (
        <SettingsPoolsSection
          pools={pools}
          agents={agents}
          openrouter={openrouter}
          onPoolsChange={onPoolsChange}
        />
      )}
    </div>
  );
}
