"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { savePools } from "@/lib/settings-api";
import { formatAgentDisplayLabel } from "@/lib/agent-identity";
import { AgentDisplayLabel } from "@/components/agent-display-label";
import {
  bundledDispatchPoolGroups,
  bundledWorkflowDispatchPoolTargets,
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

const POOL_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
];

function formatPoolAgentLabel(
  agentId: string,
  agent: RegisteredAgent | undefined,
): string {
  return agent ? formatAgentDisplayLabel(agent) : agentId;
}

function formatPoolPercent(ratio: number): string {
  const percent = Number.isFinite(ratio) && ratio > 0 ? ratio * 100 : 0;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
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

function PoolDistributionBar({
  entries,
  totalWeight,
  agents,
}: {
  entries: PoolEntry[];
  totalWeight: number;
  agents: Record<string, RegisteredAgent>;
}) {
  if (entries.length === 0 || totalWeight <= 0) return null;
  return (
    <div className={
      "flex h-3 w-full overflow-hidden rounded-full bg-muted/80 ring-1 ring-primary/10"
    }>
      {entries.map((entry, idx) => {
        const ratio = entry.weight / totalWeight;
        const color = POOL_COLORS[idx % POOL_COLORS.length];
        const agentRef = agents[entry.agentId];
        const label = formatPoolAgentLabel(entry.agentId, agentRef);
        const pct = formatPoolPercent(ratio);
        return (
          <div
            key={entry.agentId}
            className={`h-full ${color} transition-all`}
            style={{ width: `${ratio * 100}%` }}
            title={`${label} - w${entry.weight} - ${pct}%`}
          />
        );
      })}
    </div>
  );
}

function PoolAgentRow({
  entry,
  idx,
  ratio,
  agents,
  onWeightChange,
  onRemove,
}: {
  entry: PoolEntry;
  idx: number;
  ratio: number;
  agents: Record<string, RegisteredAgent>;
  onWeightChange: (weight: number) => void;
  onRemove: () => void;
}) {
  const pct = formatPoolPercent(ratio);
  const agent = agents[entry.agentId];
  const label = formatPoolAgentLabel(entry.agentId, agent);
  const color = POOL_COLORS[idx % POOL_COLORS.length];
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/35">
      <div className="w-[140px] sm:w-[220px] min-w-0 shrink-0 flex items-start gap-2">
        <span className={`mt-1 size-2.5 rounded-full shrink-0 ${color}`} />
        <div className="min-w-0 text-xs">
          {agent
            ? <AgentDisplayLabel agent={agent} layout="stacked" />
            : (
              <span className="block truncate" title={label}>
                {label}
              </span>
            )}
        </div>
      </div>
      <Input
        type="number"
        min={0}
        step={1}
        className="h-7 w-[64px] px-2 text-xs shrink-0"
        value={entry.weight}
        onChange={(e) => {
          onWeightChange(Math.max(0, Number(e.target.value) || 0));
        }}
      />
      <div className="h-2.5 flex-1 min-w-0 rounded-full overflow-hidden bg-muted">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-[88px] text-right tabular-nums shrink-0">
        w{entry.weight} · {pct}%
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 hover:bg-destructive/10"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </div>
  );
}

function AddPoolEntryForm({
  availableIds,
  agents,
  onAdd,
  onCancel,
}: {
  availableIds: string[];
  agents: Record<string, RegisteredAgent>;
  onAdd: (agentId: string, weight: number) => void;
  onCancel: () => void;
}) {
  const [selectedId, setSelectedId] = useState(availableIds[0] ?? "");
  const [weight, setWeight] = useState(1);

  return (
    <div className="flex items-center gap-2 pt-1">
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger className="h-7 w-[240px] border-primary/20 bg-background/80">
          <SelectValue placeholder="select agent" />
        </SelectTrigger>
        <SelectContent>
          {availableIds.map((id) => (
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
        className="h-7 w-[84px] px-2 text-xs"
        value={weight}
        onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
      />
      <Button
        size="sm"
        className="h-7"
        onClick={() => selectedId && onAdd(selectedId, weight)}
      >
        Add
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7"
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  );
}

function TargetPoolEditor({
  target,
  entries,
  agents,
  agentIds,
  disabled,
  onChange,
}: {
  target: DispatchPoolTargetDefinition;
  entries: PoolEntry[];
  agents: Record<string, RegisteredAgent>;
  agentIds: string[];
  disabled?: boolean;
  onChange: (entries: PoolEntry[]) => void;
}) {
  const [addingAgent, setAddingAgent] = useState(false);
  const availableIds = agentIds.filter(
    (id) => !entries.some((entry) => entry.agentId === id),
  );
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);

  return (
    <div className="rounded-xl border border-primary/18 bg-background/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-xs font-medium">{target.label}</Label>
          <p className="text-[10px] text-muted-foreground">
            {target.description}
          </p>
        </div>
        {availableIds.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="border-primary/20 bg-background/70 hover:bg-primary/10"
            onClick={() => setAddingAgent(true)}
            disabled={disabled}
          >
            <Plus className="size-3.5 mr-1" />
            Add
          </Button>
        )}
      </div>

      {entries.length === 0 && !addingAgent ? (
        <p className="text-xs text-muted-foreground italic">
          No pool configured - uses action mapping fallback
        </p>
      ) : (
        <div className="space-y-2">
          <PoolDistributionBar
            entries={entries}
            totalWeight={totalWeight}
            agents={agents}
          />
          <div className="space-y-1">
            {entries.map((entry, idx) => {
              const ratio = totalWeight > 0 ? entry.weight / totalWeight : 0;
              return (
                <PoolAgentRow
                  key={entry.agentId}
                  entry={entry}
                  idx={idx}
                  ratio={ratio}
                  agents={agents}
                  onWeightChange={(weight) => {
                    const next = [...entries];
                    next[idx] = { ...entry, weight };
                    onChange(next);
                  }}
                  onRemove={() => {
                    onChange(entries.filter((_, rowIndex) => rowIndex !== idx));
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {addingAgent && (
        <AddPoolEntryForm
          availableIds={availableIds}
          agents={agents}
          onAdd={(agentId, weight) => {
            onChange([...entries, { agentId, weight }]);
            setAddingAgent(false);
          }}
          onCancel={() => setAddingAgent(false)}
        />
      )}
    </div>
  );
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
  const groups = bundledDispatchPoolGroups();

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
    const nextPools: PoolsSettings = {
      ...pools,
      [target.id]: entries,
    };
    await persistPoolUpdate(nextPools, { [target.id]: entries });
  }

  async function handleBulkApply(agentId: string, weight: number) {
    const updates: Partial<PoolsSettings> = {};
    for (const target of bundledWorkflowDispatchPoolTargets()) {
      updates[target.id] = applyAgentToPool(
        poolEntriesForTarget(pools, target),
        agentId,
        weight,
      );
    }
    const nextPools: PoolsSettings = {
      ...pools,
      ...updates,
    };
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
        Configure weighted agent distribution per workflow step and dispatch target.
      </p>
      <DispatchPoolsBulkApply
        agents={agents}
        disabled={disabled}
        onApply={handleBulkApply}
      />
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.id} className="space-y-3">
            <div>
              <h3 className="text-xs font-medium">{group.label}</h3>
              <p className="text-[11px] text-muted-foreground">
                {group.description}
              </p>
            </div>
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
          </section>
        ))}
      </div>
    </div>
  );
}
