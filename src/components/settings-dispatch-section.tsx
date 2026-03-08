"use client";

import { toast } from "sonner";
import { Zap, Users, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsActionsSection } from "@/components/settings-actions-section";
import { SettingsPoolsSection } from "@/components/settings-pools-section";
import { SettingsDispatchGlobalSwap } from "@/components/settings-dispatch-global-swap";
import { patchSettings } from "@/lib/settings-api";
import type { RegisteredAgent } from "@/lib/types";
import type {
  ActionAgentMappings,
  PoolsSettings,
  DispatchMode,
} from "@/lib/schemas";

interface DispatchSectionProps {
  dispatchMode: DispatchMode;
  actions: ActionAgentMappings;
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
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
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Choose how agents are assigned to workflow actions.
      </p>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-background/55 p-2">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = dispatchMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => handleModeChange(mode.value)}
              className={cn(
                "relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                active
                  ? "border-primary/35 bg-[linear-gradient(135deg,rgba(168,85,247,0.14),rgba(255,255,255,0.88),rgba(74,222,128,0.14))] ring-1 ring-primary/15 dark:bg-[linear-gradient(135deg,rgba(168,85,247,0.18),rgba(39,39,42,0.9),rgba(74,222,128,0.12))]"
                  : "border-border/70 bg-background/70 hover:border-primary/20 hover:bg-muted/45",
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
                  "text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {mode.label}
              </span>
              <span className="text-[10px] text-muted-foreground">
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
            onActionsChange={onActionsChange}
          />
        </>
      ) : (
        <SettingsPoolsSection
          pools={pools}
          agents={agents}
          onPoolsChange={onPoolsChange}
        />
      )}
      <div className="space-y-2 border-t border-border/70 pt-3">
        <div>
          <p className="text-[11px] font-medium text-foreground">
            Global dispatch tools
          </p>
          <p className="text-[10px] text-muted-foreground">
            The single Swap Agent control below replaces matching agents
            everywhere in Dispatch, including action mappings and every workflow
            step.
          </p>
        </div>
        <SettingsDispatchGlobalSwap
          actions={actions}
          pools={pools}
          agents={agents}
          onActionsChange={onActionsChange}
          onPoolsChange={onPoolsChange}
        />
      </div>
    </div>
  );
}
