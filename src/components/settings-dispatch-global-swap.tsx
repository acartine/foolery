"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentDisplayLabel } from "@/components/agent-display-label";
import {
  countDispatchAgentOccurrences,
  getSwappableSourceAgentIds,
  swapActionsAgent,
  swapPoolsAgent,
} from "@/lib/agent-pool";
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

function pluralise(
  n: number,
  singular: string,
  plural: string,
): string {
  return n === 1 ? singular : plural;
}

function buildScopeParts(
  actions: ActionAgentMappings,
  pools: PoolsSettings,
  agentId: string,
): string[] {
  const occ = countDispatchAgentOccurrences(
    actions,
    pools,
    agentId,
  );
  const parts: string[] = [];
  if (occ.affectedActions > 0) {
    const label = pluralise(
      occ.affectedActions,
      "mapping",
      "mappings",
    );
    parts.push(
      `${occ.affectedActions} action ${label}`,
    );
  }
  if (occ.affectedEntries > 0) {
    const entryLabel = pluralise(
      occ.affectedEntries,
      "entry",
      "entries",
    );
    const stepLabel = pluralise(
      occ.affectedSteps,
      "target",
      "targets",
    );
    parts.push(
      `${occ.affectedEntries} pool ${entryLabel}` +
        ` across ${occ.affectedSteps} ${stepLabel}`,
    );
  }
  return parts;
}

async function performGlobalSwap(
  actions: ActionAgentMappings,
  pools: PoolsSettings,
  fromId: string,
  toId: string,
  onActionsChange: (a: ActionAgentMappings) => void,
  onPoolsChange: (p: PoolsSettings) => void,
): Promise<string | null> {
  const actionSwap = swapActionsAgent(
    actions, fromId, toId,
  );
  const poolSwap = swapPoolsAgent(
    pools, fromId, toId,
  );
  if (
    actionSwap.affectedActions === 0 &&
    poolSwap.affectedSteps === 0
  ) {
    return null;
  }

  onActionsChange(actionSwap.updatedActions);
  onPoolsChange(poolSwap.updatedPools);

  const res = await patchSettings({
    ...(actionSwap.affectedActions > 0
      ? { actions: actionSwap.updatedActions }
      : {}),
    ...(poolSwap.affectedSteps > 0
      ? { pools: poolSwap.updatedPools }
      : {}),
  });
  if (!res.ok) {
    throw new Error(res.error ?? "Failed to save swap");
  }

  const affected: string[] = [];
  if (actionSwap.affectedActions > 0) {
    const label = pluralise(
      actionSwap.affectedActions,
      "mapping",
      "mappings",
    );
    affected.push(
      `${actionSwap.affectedActions} action ${label}`,
    );
  }
  if (poolSwap.affectedSteps > 0) {
    const entryLabel = pluralise(
      poolSwap.affectedEntries,
      "entry",
      "entries",
    );
    const stepLabel = pluralise(
      poolSwap.affectedSteps,
      "target",
      "targets",
    );
    affected.push(
      `${poolSwap.affectedEntries} pool ${entryLabel}` +
        ` across ${poolSwap.affectedSteps} ${stepLabel}`,
    );
  }
  return affected.join(" and ");
}

function AgentSelectItems({
  agentIds,
  agents,
  disabledId,
}: {
  agentIds: string[];
  agents: Record<string, RegisteredAgent>;
  disabledId?: string;
}) {
  return (
    <>
      {agentIds.map((id) => (
        <SelectItem
          key={id}
          value={id}
          disabled={id === disabledId}
        >
          {agents[id]
            ? <AgentDisplayLabel agent={agents[id]!} />
            : id}
        </SelectItem>
      ))}
    </>
  );
}

interface SwapControlsPanelProps {
  disabled?: boolean;
  canSwap: boolean;
  swapFromAgentId: string;
  swapToAgentId: string;
  swappableFromAgentIds: string[];
  allAgentIds: string[];
  agents: Record<string, RegisteredAgent>;
  scopeParts: string[];
  onSwapFromChange: (v: string) => void;
  onSwapToChange: (v: string) => void;
  onSwap: () => void;
}

function SwapControlsPanel({
  disabled,
  canSwap,
  swapFromAgentId,
  swapToAgentId,
  swappableFromAgentIds,
  allAgentIds,
  agents,
  scopeParts,
  onSwapFromChange,
  onSwapToChange,
  onSwap,
}: SwapControlsPanelProps) {
  return (
    <div
      className={[
        "rounded-xl border border-primary/18",
        "bg-background/60 p-3 space-y-2",
        disabled
          ? "opacity-50 pointer-events-none"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2">
        <Select
          value={swapFromAgentId}
          onValueChange={onSwapFromChange}
        >
          <SelectTrigger className="h-7 flex-1 min-w-0 text-xs border-primary/20 bg-background/80">
            <SelectValue placeholder="current agent" />
          </SelectTrigger>
          <SelectContent>
            <AgentSelectItems
              agentIds={swappableFromAgentIds}
              agents={agents}
            />
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground shrink-0">
          to
        </span>
        <Select
          value={swapToAgentId}
          onValueChange={onSwapToChange}
        >
          <SelectTrigger className="h-7 flex-1 min-w-0 text-xs border-primary/20 bg-background/80">
            <SelectValue placeholder="replacement agent" />
          </SelectTrigger>
          <SelectContent>
            <AgentSelectItems
              agentIds={allAgentIds}
              agents={agents}
              disabledId={swapFromAgentId}
            />
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 border-primary/20 bg-background/80"
          disabled={!canSwap}
          onClick={onSwap}
        >
          Swap Agent
        </Button>
      </div>
      {scopeParts.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Dispatch-wide scope:{" "}
          {scopeParts.join(" and ")}.
        </p>
      )}
    </div>
  );
}

function collectUsedAgentIds(
  actions: ActionAgentMappings,
  pools: PoolsSettings,
): string[] {
  return [
    ...new Set([
      ...Object.values(actions).filter(
        (agentId) => agentId.length > 0,
      ),
      ...Object.values(pools).flatMap(
        (entries) => (entries ?? []).map((e) => e.agentId),
      ),
    ]),
  ];
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
  const usedAgentIds = collectUsedAgentIds(
    actions,
    pools,
  );
  const swappableFromAgentIds = getSwappableSourceAgentIds(
    usedAgentIds,
    allAgentIds,
  );

  const swapFromAgentId =
    swappableFromAgentIds.includes(swapFromSelection)
      ? swapFromSelection
      : (swappableFromAgentIds[0] ?? "");
  const defaultTo =
    allAgentIds.find((id) => id !== swapFromAgentId)
    ?? allAgentIds[0]
    ?? "";
  const swapToAgentId =
    allAgentIds.includes(swapToSelection)
    && swapToSelection !== swapFromAgentId
      ? swapToSelection
      : defaultTo;

  const canSwap =
    !disabled &&
    swappableFromAgentIds.length > 0 &&
    swapFromAgentId.length > 0 &&
    swapToAgentId.length > 0 &&
    swapFromAgentId !== swapToAgentId;
  const scopeParts = buildScopeParts(
    actions,
    pools,
    swapFromAgentId,
  );

  async function handleGlobalSwap() {
    if (!swapFromAgentId || !swapToAgentId) return;
    if (swapFromAgentId === swapToAgentId) return;
    try {
      const msg = await performGlobalSwap(
        actions,
        pools,
        swapFromAgentId,
        swapToAgentId,
        onActionsChange,
        onPoolsChange,
      );
      if (msg === null) {
        toast.error(
          "Agent not found in dispatch settings",
        );
        return;
      }
      toast.success(
        `Swapped agent across ${msg}`,
      );
      setSwapFromSelection(swapToAgentId);
    } catch {
      toast.error("Failed to save swap");
    }
  }

  if (swappableFromAgentIds.length === 0) return null;

  return (
    <SwapControlsPanel
      disabled={disabled}
      canSwap={canSwap}
      swapFromAgentId={swapFromAgentId}
      swapToAgentId={swapToAgentId}
      swappableFromAgentIds={swappableFromAgentIds}
      allAgentIds={allAgentIds}
      agents={agents}
      scopeParts={scopeParts}
      onSwapFromChange={setSwapFromSelection}
      onSwapToChange={setSwapToSelection}
      onSwap={handleGlobalSwap}
    />
  );
}
