"use client";

import { useEffect, useState } from "react";
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
import { fetchOpenRouterModels as fetchOpenRouterModelsApi, savePools } from "@/lib/settings-api";
import { swapPoolAgent } from "@/lib/agent-pool";
import {
  OPENROUTER_SELECTED_AGENT_ID,
  formatOpenRouterSelectedAgentLabel,
  getSelectedOpenRouterModel,
  resolveOpenRouterPricing,
  openrouterAgentId,
  formatOpenRouterAgentLabel,
  listUniqueOpenRouterAgentKeys,
} from "@/lib/openrouter";
import type { OpenRouterModel } from "@/lib/openrouter";
import type { RegisteredAgent } from "@/lib/types";
import type { OpenRouterSettings, PoolEntry, PoolsSettings } from "@/lib/schemas";
import { WorkflowStep } from "@/lib/workflows";

interface PoolsSectionProps {
  pools: PoolsSettings;
  agents: Record<string, RegisteredAgent>;
  openrouter: OpenRouterSettings;
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
  const base = agent?.label?.trim() || agentId;
  const model = agent?.model?.trim();
  if (!model || base.includes(model)) return base;
  return `${base} (${model})`;
}

function formatPoolPercent(ratio: number): string {
  const percent = Number.isFinite(ratio) && ratio > 0 ? ratio * 100 : 0;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

export function SettingsPoolsSection({
  pools,
  agents,
  openrouter,
  onPoolsChange,
  disabled,
}: PoolsSectionProps) {
  // Add all configured OpenRouter agents as selectable options
  const selectableAgents: Record<string, RegisteredAgent> = {
    ...agents,
  };
  if (openrouter.enabled) {
    const fallbackCommand = Object.values(agents)[0]?.command ?? "claude";
    for (const key of listUniqueOpenRouterAgentKeys(openrouter.agents)) {
      const entry = openrouter.agents[key];
      if (!entry) continue;
      const id = openrouterAgentId(key);
      selectableAgents[id] = {
        command: fallbackCommand,
        model: entry.model,
        label: formatOpenRouterAgentLabel(key, entry.label, entry.model),
      };
    }
  }

  // Legacy: keep single selected OpenRouter model if still referenced in pools
  const selectedOpenRouterModel = getSelectedOpenRouterModel(openrouter);
  const poolsUseLegacyOpenRouter = ALL_STEPS.some((step) =>
    (pools[step] ?? []).some(
      (entry) => entry.agentId === OPENROUTER_SELECTED_AGENT_ID,
    ),
  );
  if (selectedOpenRouterModel && poolsUseLegacyOpenRouter) {
    selectableAgents[OPENROUTER_SELECTED_AGENT_ID] = {
      command: Object.values(agents)[0]?.command ?? "claude",
      model: selectedOpenRouterModel,
      label: formatOpenRouterSelectedAgentLabel(selectedOpenRouterModel),
    };
  }

  // Prevent adding new legacy selected-model entries in pools.
  const agentIds = Object.keys(selectableAgents).filter(
    (id) => id !== OPENROUTER_SELECTED_AGENT_ID,
  );
  const hasAgents = agentIds.length > 0 || poolsUseLegacyOpenRouter;
  const hasModeledAgents = agentIds.some(
    (id) => Boolean(selectableAgents[id]?.model?.trim()),
  );
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasModeledAgents || openRouterModels !== null) return;
    fetchOpenRouterModelsApi()
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setOpenRouterModels(res.data);
          return;
        }
        setOpenRouterModels([]);
      })
      .catch(() => {
        if (!cancelled) setOpenRouterModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasModeledAgents, openRouterModels]);

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
            agents={selectableAgents}
            agentIds={agentIds}
            openRouterModels={openRouterModels}
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
  openRouterModels,
  onChange,
}: {
  meta: { label: string; description: string };
  entries: PoolEntry[];
  agents: Record<string, RegisteredAgent>;
  agentIds: string[];
  openRouterModels: OpenRouterModel[] | null;
  onChange: (entries: PoolEntry[]) => void;
}) {
  const [addingAgent, setAddingAgent] = useState(false);
  const [swapFromSelection, setSwapFromSelection] = useState("");
  const [swapToSelection, setSwapToSelection] = useState("");

  // Agents not yet in this pool
  const availableIds = agentIds.filter(
    (id) => !entries.some((e) => e.agentId === id),
  );
  const poolAgentIds = entries.map((entry) => entry.agentId);

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  const swapFromAgentId = poolAgentIds.includes(swapFromSelection)
    ? swapFromSelection
    : (poolAgentIds[0] ?? "");
  const swapToAgentId =
    agentIds.includes(swapToSelection) && swapToSelection !== swapFromAgentId
      ? swapToSelection
      : ((agentIds.find((id) => id !== swapFromAgentId) ?? agentIds[0]) ?? "");

  const canSwap =
    poolAgentIds.length > 0 &&
    agentIds.length > 1 &&
    swapFromAgentId.length > 0 &&
    swapToAgentId.length > 0 &&
    swapFromAgentId !== swapToAgentId &&
    !entries.some((entry) => entry.agentId === swapToAgentId);

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
              const pricing = resolveOpenRouterPricing(
                openRouterModels,
                agent?.model,
              );
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
                      {pricing && (
                        <span
                          className="text-[10px] text-muted-foreground font-mono"
                          title={pricing.modelId}
                        >
                          P {pricing.prompt} / C {pricing.completion}
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

          {poolAgentIds.length > 0 && agentIds.length > 1 && (
            <div className="mt-2 rounded-lg border border-primary/15 bg-background/70 p-2.5">
              <p className="text-[11px] font-medium text-foreground">
                Swap Agent
              </p>
              <p className="text-[10px] text-muted-foreground">
                Replace a pooled agent with another while keeping weight.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select value={swapFromAgentId} onValueChange={setSwapFromSelection}>
                  <SelectTrigger className="h-7 w-[170px] border-primary/20 bg-background/80">
                    <SelectValue placeholder="current agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {poolAgentIds.map((id) => {
                      const agent = agents[id];
                      const pricing = resolveOpenRouterPricing(
                        openRouterModels,
                        agent?.model,
                      );
                      return (
                        <SelectItem key={id} value={id}>
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="truncate">{formatPoolAgentLabel(id, agent)}</span>
                            {pricing && (
                              <span className="text-[10px] font-mono text-muted-foreground">
                                P {pricing.prompt} / C {pricing.completion}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">to</span>
                <Select value={swapToAgentId} onValueChange={setSwapToSelection}>
                  <SelectTrigger className="h-7 w-[190px] border-primary/20 bg-background/80">
                    <SelectValue placeholder="replacement agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agentIds.map((id) => {
                      const agent = agents[id];
                      const pricing = resolveOpenRouterPricing(
                        openRouterModels,
                        agent?.model,
                      );
                      const alreadyInPool =
                        id !== swapFromAgentId && poolAgentIds.includes(id);
                      return (
                        <SelectItem key={id} value={id} disabled={alreadyInPool}>
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="truncate">{formatPoolAgentLabel(id, agent)}</span>
                            {pricing && (
                              <span className="text-[10px] font-mono text-muted-foreground">
                                P {pricing.prompt} / C {pricing.completion}
                              </span>
                            )}
                            {!pricing && alreadyInPool && (
                              <span className="text-[10px] text-muted-foreground">
                                already in pool
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-primary/20 bg-background/80"
                  disabled={!canSwap}
                  onClick={() => {
                    if (!swapFromAgentId || !swapToAgentId) return;
                    if (swapFromAgentId === swapToAgentId) return;

                    if (entries.some((entry) => entry.agentId === swapToAgentId)) {
                      toast.error("Replacement agent is already in this pool");
                      return;
                    }

                    const swapped = swapPoolAgent(entries, swapFromAgentId, swapToAgentId);
                    if (swapped === entries) {
                      toast.error("Unable to swap selected agents");
                      return;
                    }

                    onChange(swapped);
                    setSwapFromSelection(swapToAgentId);
                  }}
                >
                  Swap
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {addingAgent && (
        <AddPoolEntryForm
          availableIds={availableIds}
          agents={agents}
          openRouterModels={openRouterModels}
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
  openRouterModels,
  onAdd,
  onCancel,
}: {
  availableIds: string[];
  agents: Record<string, RegisteredAgent>;
  openRouterModels: OpenRouterModel[] | null;
  onAdd: (agentId: string, weight: number) => void;
  onCancel: () => void;
}) {
  const [selectedId, setSelectedId] = useState(availableIds[0] ?? "");
  const [weight, setWeight] = useState(1);

  return (
    <div className="flex items-center gap-2 pt-1">
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger className="h-7 w-[140px] border-primary/20 bg-background/80">
          <SelectValue placeholder="select agent" />
        </SelectTrigger>
        <SelectContent>
          {availableIds.map((id) => {
            const agent = agents[id];
            const pricing = resolveOpenRouterPricing(
              openRouterModels,
              agent?.model,
            );
            return (
              <SelectItem key={id} value={id}>
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">
                    {formatPoolAgentLabel(id, agent)}
                  </span>
                  {pricing && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      P {pricing.prompt} / C {pricing.completion}
                    </span>
                  )}
                </div>
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
