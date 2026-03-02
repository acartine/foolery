"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Users } from "lucide-react";
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
import type { RegisteredAgent } from "@/lib/types";
import type { PoolEntry, PoolsSettings } from "@/lib/schemas";
import { WorkflowStep } from "@/lib/workflows";

interface PoolsSectionProps {
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  onPoolsChange: (pools: PoolsSettings) => void;
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

export function SettingsPoolsSection({
  pools,
  agents,
  onPoolsChange,
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
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Agent Pools</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Register agents in the General tab first, then configure pools here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Agent Pools</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Configure weighted agent distribution for each workflow step.
        Agents are selected randomly based on relative weights.
      </p>
      <div className="space-y-5">
        {ALL_STEPS.map((step) => (
          <StepPoolEditor
            key={step}
            step={step}
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
  step,
  meta,
  entries,
  agents,
  agentIds,
  onChange,
}: {
  step: string;
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
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">{meta.label}</Label>
          <p className="text-[11px] text-muted-foreground">
            {meta.description}
          </p>
        </div>
        {availableIds.length > 0 && (
          <Button
            variant="outline"
            size="sm"
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
        <div className="space-y-1.5">
          {entries.map((entry, idx) => {
            const pct =
              totalWeight > 0
                ? Math.round((entry.weight / totalWeight) * 100)
                : 0;
            return (
              <div
                key={entry.agentId}
                className="flex items-center gap-2"
              >
                <span className="text-sm min-w-[80px] truncate">
                  {agents[entry.agentId]?.label ?? entry.agentId}
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="h-7 w-[70px] px-2 text-sm"
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
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-[36px] text-right">
                  {pct}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
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
        <SelectTrigger className="w-[140px] h-7">
          <SelectValue placeholder="select agent" />
        </SelectTrigger>
        <SelectContent>
          {availableIds.map((id) => (
            <SelectItem key={id} value={id}>
              {agents[id]?.label ?? id}
            </SelectItem>
          ))}
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
        className="h-7"
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
