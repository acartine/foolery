"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { savePools } from "@/lib/settings-api";
import { AgentDisplayLabel } from "@/components/agent-display-label";
import { TargetPoolEditor } from "@/components/settings-pools-target-editor";
import {
  dispatchWorkflowGroups,
  dispatchWorkflowPoolTargets,
  scopeRefinementDispatchTarget,
  staleGroomingDispatchTarget,
  type DispatchPoolTargetDefinition,
} from "@/lib/settings-dispatch-targets";
import type { RegisteredAgent } from "@/lib/types";
import type { PoolEntry, PoolsSettings } from "@/lib/schemas";

interface PoolsSectionProps {
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  onPoolsChange: (pools: PoolsSettings) => void;
  disabled?: boolean;
}

function cloneEntries(entries: PoolEntry[]): PoolEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function applyAgentToPool(
  entries: PoolEntry[],
  agentId: string,
  weight: number,
): PoolEntry[] {
  const existingIndex = entries.findIndex(
    (entry) => entry.agentId === agentId,
  );
  if (existingIndex < 0) {
    return [...entries, { agentId, weight }];
  }
  return entries.map((entry, index) => (
    index === existingIndex ? { ...entry, weight } : entry
  ));
}

function poolEntriesForTarget(
  pools: PoolsSettings,
  target: DispatchPoolTargetDefinition,
): PoolEntry[] {
  if (target.id in pools) {
    return cloneEntries(pools[target.id] ?? []);
  }
  return cloneEntries(pools[target.legacyTargetId] ?? []);
}

function DispatchPoolsBulkApply({
  agents,
  disabled,
  onApply,
}: {
  agents: Record<string, RegisteredAgent>;
  disabled?: boolean;
  onApply: (agentId: string, weight: number) => void;
}) {
  const agentIds = Object.keys(agents);
  const [agentId, setAgentId] = useState(agentIds[0] ?? "");
  const [weight, setWeight] = useState(1);
  if (agentIds.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/18 bg-background/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <div>
          <p className="text-xs font-medium">Add to all</p>
          <p className="text-[10px] text-muted-foreground">
            Seed one agent choice across all bundled workflow targets,
            then adjust any target individually.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger className="h-8 min-w-0 flex-1 border-primary/20 bg-background/80">
            <SelectValue placeholder="select agent" />
          </SelectTrigger>
          <SelectContent>
            {agentIds.map((id) => (
              <SelectItem key={id} value={id}>
                {agents[id] ? <AgentDisplayLabel agent={agents[id]!} /> : id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={1}
          step={1}
          className="h-8 w-[84px] px-2 text-xs"
          value={weight}
          onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
        />
        <Button
          size="sm"
          className="h-8 shrink-0"
          onClick={() => agentId && onApply(agentId, weight)}
          disabled={disabled}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

export function SettingsPoolsSection({
  pools,
  agents,
  onPoolsChange,
  disabled,
}: PoolsSectionProps) {
  const agentIds = Object.keys(agents);
  const groups = dispatchWorkflowGroups();
  const [activeId, setActiveId] = useState(groups[0]?.id ?? "");

  async function persistPoolUpdate(nextPools: PoolsSettings, updates: Partial<PoolsSettings>) {
    onPoolsChange(nextPools);
    try {
      const res = await savePools(updates);
      if (!res.ok) {
        toast.error(res.error ?? "Failed to save pool");
      }
    } catch {
      toast.error("Failed to save pool");
    }
  }

  async function handleTargetPoolChange(
    target: DispatchPoolTargetDefinition,
    entries: PoolEntry[],
  ) {
    const nextPools: PoolsSettings = { ...pools, [target.id]: entries };
    await persistPoolUpdate(nextPools, { [target.id]: entries });
  }

  async function handleBulkApply(agentId: string, weight: number) {
    const updates: Partial<PoolsSettings> = {};
    for (const target of dispatchWorkflowPoolTargets()) {
      updates[target.id] = applyAgentToPool(
        poolEntriesForTarget(pools, target),
        agentId,
        weight,
      );
    }
    const nextPools: PoolsSettings = { ...pools, ...updates };
    await persistPoolUpdate(nextPools, updates);
  }

  if (agentIds.length === 0) {
    return (
      <div className={disabled ? "space-y-3 opacity-50 pointer-events-none" : "space-y-3"}>
        <p className="text-[11px] text-muted-foreground">
          Register agents first, then configure pools here.
        </p>
      </div>
    );
  }

  return (
    <div className={disabled ? "space-y-4 opacity-50 pointer-events-none" : "space-y-4"}>
      <p className="text-[11px] text-muted-foreground">
        Configure weighted agent distribution per workflow.
      </p>
      <DispatchPoolsBulkApply
        agents={agents}
        disabled={disabled}
        onApply={handleBulkApply}
      />
      <SharedPoolEditors
        pools={pools}
        agents={agents}
        agentIds={agentIds}
        disabled={disabled}
        onTargetPoolChange={handleTargetPoolChange}
      />
      <Tabs value={activeId} onValueChange={setActiveId}>
        <TabsList className="w-full">
          {groups.map((group) => (
            <TabsTrigger key={group.id} value={group.id}>
              {group.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map((group) => (
          <TabsContent key={group.id} value={group.id} className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              {group.description}
            </p>
            <div className="space-y-3">
              {group.targets.map((target) => (
                <TargetPoolEditor
                  key={target.id}
                  target={target}
                  entries={poolEntriesForTarget(pools, target)}
                  agents={agents}
                  agentIds={agentIds}
                  disabled={disabled}
                  onChange={(entries) => handleTargetPoolChange(target, entries)}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function SharedPoolEditors({
  pools,
  agents,
  agentIds,
  disabled,
  onTargetPoolChange,
}: {
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  agentIds: string[];
  disabled?: boolean;
  onTargetPoolChange: (
    target: DispatchPoolTargetDefinition,
    entries: PoolEntry[],
  ) => Promise<void>;
}) {
  const targets = [
    scopeRefinementDispatchTarget(),
    staleGroomingDispatchTarget(),
  ];

  return (
    <>
      {targets.map((target) => (
        <TargetPoolEditor
          key={target.id}
          target={target}
          entries={poolEntriesForTarget(pools, target)}
          agents={agents}
          agentIds={agentIds}
          disabled={disabled}
          onChange={(entries) => onTargetPoolChange(target, entries)}
        />
      ))}
    </>
  );
}
