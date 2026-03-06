"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAgentDisplayLabel } from "@/lib/agent-identity";
import { swapActionsAgent, swapPoolsAgent } from "@/lib/agent-pool";
import { patchSettings } from "@/lib/settings-api";
import type { RegisteredAgent } from "@/lib/types";
import type { ActionAgentMappings, PoolsSettings } from "@/lib/schemas";

interface DispatchGlobalSwapAgentProps {
  actions: ActionAgentMappings;
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  onActionsChange: (actions: ActionAgentMappings) => void;
  onPoolsChange: (pools: PoolsSettings) => void;
  disabled?: boolean;
}

function formatAgentLabel(
  agentId: string,
  agent: RegisteredAgent | undefined,
): string {
  return agent ? formatAgentDisplayLabel(agent) : agentId;
}

export function SettingsDispatchGlobalSwap({
  actions,
  pools,
  agents,
  onActionsChange,
  onPoolsChange,
  disabled,
}: DispatchGlobalSwapAgentProps) {
  const [swapFromSelection, setSwapFromSelection] = useState("");
  const [swapToSelection, setSwapToSelection] = useState("");

  const allAgentIds = Object.keys(agents);
  const usedAgentIds = [
    ...new Set([
      ...Object.values(actions).filter((agentId) => agentId.length > 0),
      ...Object.values(pools).flatMap((entries) =>
        entries.map((entry) => entry.agentId),
      ),
    ]),
  ];

  const swapFromAgentId = usedAgentIds.includes(swapFromSelection)
    ? swapFromSelection
    : (usedAgentIds[0] ?? "");
  const swapToAgentId =
    allAgentIds.includes(swapToSelection) && swapToSelection !== swapFromAgentId
      ? swapToSelection
      : ((allAgentIds.find((id) => id !== swapFromAgentId) ?? allAgentIds[0]) ?? "");

  const canSwap =
    !disabled &&
    usedAgentIds.length > 0 &&
    swapFromAgentId.length > 0 &&
    swapToAgentId.length > 0 &&
    swapFromAgentId !== swapToAgentId;

  async function handleGlobalSwap() {
    if (!swapFromAgentId || !swapToAgentId) return;
    if (swapFromAgentId === swapToAgentId) return;

    const actionSwap = swapActionsAgent(actions, swapFromAgentId, swapToAgentId);
    const poolSwap = swapPoolsAgent(pools, swapFromAgentId, swapToAgentId);
    if (actionSwap.affectedActions === 0 && poolSwap.affectedSteps === 0) {
      toast.error("Agent not found in dispatch settings");
      return;
    }

    onActionsChange(actionSwap.updatedActions);
    onPoolsChange(poolSwap.updatedPools);

    try {
      const res = await patchSettings({
        ...(actionSwap.affectedActions > 0
          ? { actions: actionSwap.updatedActions }
          : {}),
        ...(poolSwap.affectedSteps > 0 ? { pools: poolSwap.updatedPools } : {}),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Failed to save swap");
        return;
      }
    } catch {
      toast.error("Failed to save swap");
      return;
    }

    const affectedParts: string[] = [];
    if (actionSwap.affectedActions > 0) {
      affectedParts.push(
        `${actionSwap.affectedActions} action mapping${actionSwap.affectedActions > 1 ? "s" : ""}`,
      );
    }
    if (poolSwap.affectedSteps > 0) {
      affectedParts.push(
        `${poolSwap.affectedSteps} pool step${poolSwap.affectedSteps > 1 ? "s" : ""}`,
      );
    }
    toast.success(`Swapped agent across ${affectedParts.join(" and ")}`);
    setSwapFromSelection(swapToAgentId);
  }

  if (allAgentIds.length < 2 || usedAgentIds.length === 0) return null;

  return (
    <div
      className={
        disabled
          ? "rounded-xl border border-primary/18 bg-background/60 p-3 space-y-2 opacity-50 pointer-events-none"
          : "rounded-xl border border-primary/18 bg-background/60 p-3 space-y-2"
      }
    >
      <div>
        <Label className="text-xs font-medium">Swap Agent (Global)</Label>
        <p className="text-[10px] text-muted-foreground">
          Replace an agent across all dispatch mappings and pool steps.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={swapFromAgentId} onValueChange={setSwapFromSelection}>
          <SelectTrigger className="h-7 w-[170px] border-primary/20 bg-background/80">
            <SelectValue placeholder="current agent" />
          </SelectTrigger>
          <SelectContent>
            {usedAgentIds.map((id) => (
              <SelectItem key={id} value={id}>
                {formatAgentLabel(id, agents[id])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">to</span>
        <Select value={swapToAgentId} onValueChange={setSwapToSelection}>
          <SelectTrigger className="h-7 w-[190px] border-primary/20 bg-background/80">
            <SelectValue placeholder="replacement agent" />
          </SelectTrigger>
          <SelectContent>
            {allAgentIds.map((id) => (
              <SelectItem key={id} value={id} disabled={id === swapFromAgentId}>
                {formatAgentLabel(id, agents[id])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-primary/20 bg-background/80"
          disabled={!canSwap}
          onClick={handleGlobalSwap}
        >
          Swap
        </Button>
      </div>
    </div>
  );
}
