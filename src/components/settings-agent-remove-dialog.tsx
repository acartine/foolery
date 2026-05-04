"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ActionName,
  AgentRemovalImpact,
  AgentRemovalRequest,
  RegisteredAgent,
  SettingsPoolTargetId,
} from "@/lib/types";
import { AgentDisplayLabel } from "@/components/agent-display-label";

const ACTION_LABELS: Record<ActionName, string> = {
  take: "Take",
  scene: "Scene",
  scopeRefinement: "Scope Refinement",
  staleGrooming: "Stale Grooming",
};

type PoolModes = Partial<
  Record<SettingsPoolTargetId, "remove" | "replace">
>;
type PoolReplacements = Partial<
  Record<SettingsPoolTargetId, string>
>;
type ActionReplacements = Partial<
  Record<ActionName, string>
>;

interface SettingsAgentRemoveDialogProps {
  agents: Record<string, RegisteredAgent>;
  impact: AgentRemovalImpact | null;
  open: boolean;
  removing: boolean;
  onConfirm: (request: AgentRemovalRequest) => void;
  onOpenChange: (open: boolean) => void;
}

function ReplacementSelect({
  value,
  agentIds,
  agents,
  onChange,
  placeholder,
}: {
  value: string;
  agentIds: string[];
  agents: Record<string, RegisteredAgent>;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="border-primary/20 bg-background/80">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {agentIds.map((agentId) => (
          <SelectItem key={agentId} value={agentId}>
            {agents[agentId]
              ? <AgentDisplayLabel agent={agents[agentId]!} />
              : agentId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function buildInitialPoolModes(
  impact: AgentRemovalImpact,
): PoolModes {
  return Object.fromEntries(
    impact.poolUsages.map((usage) => [
      usage.targetId,
      usage.requiresReplacement
        ? "replace"
        : "remove",
    ]),
  ) as PoolModes;
}

function buildPoolDecisions(
  impact: AgentRemovalImpact,
  poolModes: PoolModes,
  poolReplacements: PoolReplacements,
): AgentRemovalRequest["poolDecisions"] {
  return Object.fromEntries(
    impact.poolUsages.map((usage) => {
      const mode = usage.requiresReplacement
        ? "replace"
        : poolModes[usage.targetId] ?? "remove";
      return [usage.targetId, {
        mode,
        ...(mode === "replace"
          ? {
            replacementAgentId:
              poolReplacements[usage.targetId],
          }
          : {}),
      }];
    }),
  ) as AgentRemovalRequest["poolDecisions"];
}

function isConfirmDisabled(
  impact: AgentRemovalImpact,
  removing: boolean,
  actionReplacements: ActionReplacements,
  poolModes: PoolModes,
  poolReplacements: PoolReplacements,
): boolean {
  const missingActionReplacement =
    impact.actionUsages.some(
      (usage) =>
        !actionReplacements[usage.action],
    );
  const missingPoolReplacement =
    impact.poolUsages.some((usage) => {
      const mode = usage.requiresReplacement
        ? "replace"
        : poolModes[usage.targetId] ?? "remove";
      return (
        mode === "replace"
        && !poolReplacements[usage.targetId]
      );
    });

  return (
    removing
    || !impact.canRemove
    || missingActionReplacement
    || missingPoolReplacement
  );
}

function ActionUsageSection({
  actionReplacements,
  agents,
  impact,
  onChange,
}: {
  actionReplacements: ActionReplacements;
  agents: Record<string, RegisteredAgent>;
  impact: AgentRemovalImpact;
  onChange: (
    action: ActionName,
    value: string,
  ) => void;
}) {
  if (impact.actionUsages.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">
          Action Mappings
        </p>
        <p className="text-xs text-muted-foreground">
          Action mappings cannot be left empty. Pick a replacement for each
          affected action.
        </p>
      </div>
      {impact.actionUsages.map((usage) => (
        <div
          key={usage.action}
          className="rounded-lg border border-primary/15 bg-background/60 p-3"
        >
          <Label className="text-xs">
            {ACTION_LABELS[usage.action]}
          </Label>
          <ReplacementSelect
            value={actionReplacements[usage.action] ?? ""}
            agentIds={impact.replacementAgentIds}
            agents={agents}
            onChange={(value) =>
              onChange(usage.action, value)
            }
            placeholder="select replacement agent"
          />
        </div>
      ))}
    </div>
  );
}

function PoolUsageCard({
  agents,
  impact,
  mode,
  poolReplacement,
  usage,
  onModeChange,
  onReplacementChange,
}: {
  agents: Record<string, RegisteredAgent>;
  impact: AgentRemovalImpact;
  mode: "remove" | "replace";
  poolReplacement: string;
  usage: AgentRemovalImpact["poolUsages"][number];
  onModeChange: (
    targetId: SettingsPoolTargetId,
    value: "remove" | "replace",
  ) => void;
  onReplacementChange: (
    targetId: SettingsPoolTargetId,
    value: string,
  ) => void;
}) {
  return (
    <div className="rounded-lg border border-primary/15 bg-background/60 p-3 space-y-3">
      <div>
        <p className="text-xs font-medium">
          {usage.targetLabel}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {usage.targetGroupLabel}.{" "}
          {usage.affectedEntries} matching entr
          {usage.affectedEntries === 1 ? "y" : "ies"}.{" "}
          {usage.remainingEntries > 0
            ? `${usage.remainingEntries} other entr${usage.remainingEntries === 1 ? "y remains" : "ies remain"}.`
            : "This pool would be empty after removal."}
        </p>
      </div>

      {!usage.requiresReplacement && (
        <Select
          value={mode}
          onValueChange={(value) =>
            onModeChange(
              usage.targetId,
              value as "remove" | "replace",
            )
          }
        >
          <SelectTrigger className="border-primary/20 bg-background/80">
            <SelectValue placeholder="choose action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="remove">
              Remove from this pool
            </SelectItem>
            <SelectItem value="replace">
              Replace in this pool
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {mode === "replace" && (
        <ReplacementSelect
          value={poolReplacement}
          agentIds={impact.replacementAgentIds}
          agents={agents}
          onChange={(value) =>
            onReplacementChange(usage.targetId, value)
          }
          placeholder="select replacement agent"
        />
      )}
    </div>
  );
}

function PoolUsageSection({
  agents,
  impact,
  poolModes,
  poolReplacements,
  onModeChange,
  onReplacementChange,
}: {
  agents: Record<string, RegisteredAgent>;
  impact: AgentRemovalImpact;
  poolModes: PoolModes;
  poolReplacements: PoolReplacements;
  onModeChange: (
    targetId: SettingsPoolTargetId,
    value: "remove" | "replace",
  ) => void;
  onReplacementChange: (
    targetId: SettingsPoolTargetId,
    value: string,
  ) => void;
}) {
  if (impact.poolUsages.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">
          Workflow Pools
        </p>
        <p className="text-xs text-muted-foreground">
          Choose whether to remove the agent from each pool or replace it.
        </p>
      </div>
      {impact.poolUsages.map((usage) => (
        <PoolUsageCard
          key={usage.targetId}
          agents={agents}
          impact={impact}
          mode={
            usage.requiresReplacement
              ? "replace"
              : poolModes[usage.targetId] ?? "remove"
          }
          poolReplacement={
            poolReplacements[usage.targetId] ?? ""
          }
          usage={usage}
          onModeChange={onModeChange}
          onReplacementChange={onReplacementChange}
        />
      ))}
    </div>
  );
}

function RemovalUnavailableNotice() {
  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
      This agent is still required by at least one action or pool, and there is
      no other registered agent available to replace it.
    </div>
  );
}

function RemovalDialogFooter({
  confirmDisabled,
  onCancel,
  onConfirm,
  removing,
}: {
  confirmDisabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  removing: boolean;
}) {
  return (
    <DialogFooter>
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={removing}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {removing ? "Removing..." : "Remove Agent"}
      </Button>
    </DialogFooter>
  );
}

function RemovalForm({
  agents,
  impact,
  removing,
  onConfirm,
  onOpenChange,
}: {
  agents: Record<string, RegisteredAgent>;
  impact: AgentRemovalImpact;
  removing: boolean;
  onConfirm: (request: AgentRemovalRequest) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [actionReplacements, setActionReplacements] =
    useState<ActionReplacements>({});
  const [poolModes, setPoolModes] = useState<PoolModes>(
    () => buildInitialPoolModes(impact),
  );
  const [poolReplacements, setPoolReplacements] =
    useState<PoolReplacements>({});
  const confirmDisabled = useMemo(
    () =>
      isConfirmDisabled(
        impact,
        removing,
        actionReplacements,
        poolModes,
        poolReplacements,
      ),
    [
      actionReplacements,
      impact,
      poolModes,
      poolReplacements,
      removing,
    ],
  );

  return (
    <>
      {!impact.canRemove && <RemovalUnavailableNotice />}

      <ActionUsageSection
        actionReplacements={actionReplacements}
        agents={agents}
        impact={impact}
        onChange={(action, value) =>
          setActionReplacements((current) => ({
            ...current,
            [action]: value,
          }))
        }
      />

      <PoolUsageSection
        agents={agents}
        impact={impact}
        poolModes={poolModes}
        poolReplacements={poolReplacements}
        onModeChange={(step, value) =>
          setPoolModes((current) => ({
            ...current,
            [step]: value,
          }))
        }
        onReplacementChange={(step, value) =>
          setPoolReplacements((current) => ({
            ...current,
            [step]: value,
          }))
        }
      />

      <RemovalDialogFooter
        confirmDisabled={confirmDisabled}
        onCancel={() => onOpenChange(false)}
        onConfirm={() =>
          onConfirm({
            id: impact.agentId,
            actionReplacements,
            poolDecisions: buildPoolDecisions(
              impact,
              poolModes,
              poolReplacements,
            ),
          })
        }
        removing={removing}
      />
    </>
  );
}

export function SettingsAgentRemoveDialog({
  agents,
  impact,
  open,
  removing,
  onConfirm,
  onOpenChange,
}: SettingsAgentRemoveDialogProps) {
  if (!impact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Remove Agent
          </DialogTitle>
          <DialogDescription>
            {impact.registered
              ? `Choose how to remove ${impact.agentId} from your settings.`
              : `Agent ${impact.agentId} is no longer registered.`}
          </DialogDescription>
        </DialogHeader>
        <RemovalForm
          key={impact.agentId}
          agents={agents}
          impact={impact}
          removing={removing}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
