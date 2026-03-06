"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
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
import type { RegisteredAgent } from "@/lib/types";
import type { PoolEntry, PoolsSettings } from "@/lib/schemas";
import { WorkflowStep } from "@/lib/workflows";

interface PoolsSectionProps {
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  onPoolsChange: (pools: PoolsSettings) => void;
  disabled?: boolean;
}

const STEP_LABELS: Record<string, { label: string; description: string }> = {
  [WorkflowStep.Planning]: {
    label: "Planning",
    description: "Agent writes the implementation plan",
  },
  [WorkflowStep.PlanReview]: {
    label: "Plan Review",
    description: "Agent reviews the plan for quality",
  },
  [WorkflowStep.Implementation]: {
    label: "Implementation",
    description: "Agent writes the code",
  },
  [WorkflowStep.ImplementationReview]: {
    label: "Impl Review",
    description: "Agent reviews the implementation",
  },
  [WorkflowStep.Shipment]: {
    label: "Shipment",
    description: "Agent handles shipping and deployment",
  },
  [WorkflowStep.ShipmentReview]: {
    label: "Ship Review",
    description: "Agent reviews the shipment",
  },
};

const ALL_STEPS = Object.values(WorkflowStep);

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

export function SettingsPoolsSection({
  pools,
  agents,
  onPoolsChange,
  disabled,
}: PoolsSectionProps) {
  const agentIds = Object.keys(agents);
  const hasAgents = agentIds.length > 0;

  async function handlePoolChange(
    step: string,
    entries: PoolEntry[],
  ) {
    const updated = { ...pools, [step]: entries };
    onPoolsChange(updated);
    try {
      const res = await savePools({ [step]: entries });
      if (!res.ok) {
        toast.error(res.error ?? "Failed to save pool");
      }
    } catch {
      toast.error("Failed to save pool");
    }
  }

  if (!hasAgents) {
    return (
      <div className={disabled ? "space-y-3 opacity-50 pointer-events-none" : "space-y-3"}>
        <p className="text-[11px] text-muted-foreground">
          Register agents first, then configure pools here.
        </p>
      </div>
    );
  }

  return (
    <div className={disabled ? "space-y-3 opacity-50 pointer-events-none" : "space-y-3"}>
      <p className="text-[11px] text-muted-foreground">
        Configure weighted agent distribution per workflow step.
      </p>
      <div className="space-y-4">
        {ALL_STEPS.map((step) => (
          <StepPoolEditor
            key={step}
            meta={STEP_LABELS[step]!}
            entries={pools[step] ?? []}
            agents={agents}
            agentIds={agentIds}
            onChange={(entries) => handlePoolChange(step, entries)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Per-step pool editor ──────────────────────────────────── */

function StepPoolEditor({
  meta,
  entries,
  agents,
  agentIds,
  onChange,
}: {
  meta: { label: string; description: string };
  entries: PoolEntry[];
  agents: Record<string, RegisteredAgent>;
  agentIds: string[];
  onChange: (entries: PoolEntry[]) => void;
}) {
  const [addingAgent, setAddingAgent] = useState(false);

  // Agents not yet in this pool
  const availableIds = agentIds.filter(
    (id) => !entries.some((e) => e.agentId === id),
  );

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  return (
    <div className="rounded-xl border border-primary/18 bg-background/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-medium">{meta.label}</Label>
          <p className="text-[10px] text-muted-foreground">
            {meta.description}
          </p>
        </div>
        {availableIds.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="border-primary/20 bg-background/70 hover:bg-primary/10"
            onClick={() => setAddingAgent(true)}
          >
            <Plus className="size-3.5 mr-1" />
            Add
          </Button>
        )}
      </div>

      {entries.length === 0 && !addingAgent ? (
        <p className="text-xs text-muted-foreground italic">
          No pool configured — uses action mapping fallback
        </p>
      ) : (
        <div className="space-y-2">
          {/* Stacked horizontal bar */}
          {entries.length > 0 && totalWeight > 0 && (
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/80 ring-1 ring-primary/10">
              {entries.map((entry, idx) => {
                const ratio = entry.weight / totalWeight;
                const color = POOL_COLORS[idx % POOL_COLORS.length];
                return (
                  <div
                    key={entry.agentId}
                    className={`h-full ${color} transition-all`}
                    style={{ width: `${ratio * 100}%` }}
                    title={`${formatPoolAgentLabel(entry.agentId, agents[entry.agentId])} — w${entry.weight} · ${formatPoolPercent(ratio)}%`}
                  />
                );
              })}
            </div>
          )}

          {/* Agent rows */}
          <div className="space-y-1">
            {entries.map((entry, idx) => {
              const ratio = totalWeight > 0 ? entry.weight / totalWeight : 0;
              const pct = formatPoolPercent(ratio);
              const agent = agents[entry.agentId];
              const label = formatPoolAgentLabel(entry.agentId, agent);
              const color = POOL_COLORS[idx % POOL_COLORS.length];
              return (
                <div
                  key={entry.agentId}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/35"
                >
                  <div className="w-[140px] sm:w-[220px] min-w-0 shrink-0 flex items-start gap-2">
                    <span className={`mt-1 size-2.5 rounded-full shrink-0 ${color}`} />
                    <div className="min-w-0">
                      <span className="text-xs block truncate" title={label}>
                        {label}
                      </span>
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    className="h-7 w-[64px] px-2 text-xs shrink-0"
                    value={entry.weight}
                    onChange={(e) => {
                      const next = [...entries];
                      next[idx] = {
                        ...entry,
                        weight: Math.max(0, Number(e.target.value) || 0),
                      };
                      onChange(next);
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
                    onClick={() => {
                      onChange(entries.filter((_, i) => i !== idx));
                    }}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
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

/* ── Add pool entry form ──────────────────────────────────── */

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
          {availableIds.map((id) => {
            const agent = agents[id];
            return (
              <SelectItem key={id} value={id}>
                {formatPoolAgentLabel(id, agent)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={1}
        step={1}
        className="h-7 w-[70px] px-2 text-sm"
        value={weight}
        onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
      />
      <Button
        size="sm"
        className="h-7 bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95"
        disabled={!selectedId}
        onClick={() => onAdd(selectedId, weight)}
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
