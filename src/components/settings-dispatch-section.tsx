"use client";

import { toast } from "sonner";
import { Zap, Users, Check, GitBranch } from "lucide-react";
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
      <div className="flex items-center gap-2">
        <GitBranch className="size-4 text-primary drop-shadow-[0_0_8px_rgba(137,87,255,0.45)]" />
        <h3 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-sm font-medium text-transparent">
          Agent Dispatch
        </h3>
      </div>
      <div className="rounded-lg border border-accent/45 bg-gradient-to-r from-primary/20 via-primary/8 to-accent/20 px-3 py-2 ring-1 ring-accent/20">
        <p className="text-xs text-primary/95">
          Choose how agents are assigned to workflow actions. Only the active
          mode is used at runtime.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-primary/55 bg-gradient-to-r from-primary/24 via-primary/10 to-accent/24 p-2 ring-1 ring-primary/22">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = dispatchMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => handleModeChange(mode.value)}
              className={cn(
                "relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
                active
                  ? "border-primary/80 bg-gradient-to-br from-primary/44 via-primary/20 to-accent/34 ring-1 ring-primary/55 shadow-md shadow-primary/30"
                  : "border-primary/40 bg-gradient-to-br from-primary/24 via-primary/10 to-accent/20 hover:-translate-y-0.5 hover:border-accent/65 hover:from-primary/32 hover:to-accent/30 hover:shadow-sm hover:shadow-accent/20",
              )}
            >
              {active && (
                <div className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-gradient-to-r from-primary to-accent shadow-sm shadow-primary/35">
                  <Check className="size-2.5 text-primary-foreground" />
                </div>
              )}
              <Icon
                className={cn(
                  "size-4",
                  active ? "text-primary drop-shadow-[0_0_8px_rgba(137,87,255,0.55)]" : "text-accent",
                )}
              />
              <span
                className={cn(
                  "text-sm font-medium",
                  active ? "text-foreground" : "text-foreground/80",
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
