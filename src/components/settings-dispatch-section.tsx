"use client";

import { toast } from "sonner";
import { Zap, Users } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsActionsSection } from "@/components/settings-actions-section";
import { SettingsPoolsSection } from "@/components/settings-pools-section";
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

export function SettingsDispatchSection({
  dispatchMode,
  actions,
  pools,
  agents,
  onDispatchModeChange,
  onActionsChange,
  onPoolsChange,
}: DispatchSectionProps) {
  async function handleModeChange(mode: string) {
    const newMode = mode as DispatchMode;
    onDispatchModeChange(newMode);
    try {
      const res = await patchSettings({ dispatchMode: newMode });
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
        Choose how agents are assigned to workflow actions.
      </p>

      <Tabs value={dispatchMode} onValueChange={handleModeChange}>
        <TabsList className="w-full">
          <TabsTrigger value="actions" className="flex-1 gap-1.5">
            <Zap className="size-3.5" />
            Simple
          </TabsTrigger>
          <TabsTrigger value="pools" className="flex-1 gap-1.5">
            <Users className="size-3.5" />
            Advanced
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        {dispatchMode === "actions"
          ? "Simple mode maps one agent per action. Easy to set up but every action always uses the same agent."
          : "Advanced mode uses weighted pools per workflow step, enabling load balancing and agent rotation."}
      </p>

      {dispatchMode === "actions" ? (
        <SettingsActionsSection
          actions={actions}
          agents={agents}
          onActionsChange={onActionsChange}
        />
      ) : (
        <SettingsPoolsSection
          pools={pools}
          agents={agents}
          onPoolsChange={onPoolsChange}
        />
      )}
    </div>
  );
}
