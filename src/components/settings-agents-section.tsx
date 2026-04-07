"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  AgentRemovalImpact,
  AgentRemovalRequest,
  RegisteredAgent,
  ScannedAgent,
} from "@/lib/types";
import type {
  FoolerySettings,
} from "@/lib/schemas";
import {
  addAgent,
  fetchAgentRemovalImpact,
  removeAgent,
} from "@/lib/settings-api";
import {
  AddAgentForm,
  AgentRow,
} from "@/components/settings-agents-forms";
import {
  ScannedAgentsList,
} from "@/components/settings-agents-scanned";
import {
  SettingsAgentRemoveDialog,
} from "@/components/settings-agent-remove-dialog";
import {
  useAgentMutations,
  useAgentScanner,
} from "@/components/settings-agents-hooks";

interface AgentsSectionProps {
  agents: Record<string, RegisteredAgent>;
  onSettingsChange: (next: {
    agents: Record<string, RegisteredAgent>;
    actions?: FoolerySettings["actions"];
    pools?: FoolerySettings["pools"];
  }) => void;
}

function applySettingsSnapshot(
  settings: FoolerySettings,
  onSettingsChange: AgentsSectionProps["onSettingsChange"],
) {
  onSettingsChange({
    agents: settings.agents,
    actions: settings.actions,
    pools: settings.pools,
  });
}

function useAgentRemovalFlow(
  onSettingsChange: AgentsSectionProps["onSettingsChange"],
) {
  const [removalImpact, setRemovalImpact] =
    useState<AgentRemovalImpact | null>(null);
  const [removing, setRemoving] =
    useState(false);

  const requestRemove = useCallback(
    async (id: string, successLabel?: string) => {
      const impactRes =
        await fetchAgentRemovalImpact(id);
      if (!impactRes.ok || !impactRes.data) {
        toast.error(
          impactRes.error
            ?? "Failed to inspect agent removal",
        );
        return;
      }

      const impact = impactRes.data;
      if (
        impact.actionUsages.length > 0
        || impact.poolUsages.length > 0
      ) {
        setRemovalImpact(impact);
        return;
      }

      const removeRes = await removeAgent({ id });
      if (removeRes.ok && removeRes.data) {
        applySettingsSnapshot(
          removeRes.data,
          onSettingsChange,
        );
        toast.success(
          successLabel ?? `Removed ${id}`,
        );
        return;
      }
      toast.error(
        removeRes.error
          ?? "Failed to remove agent",
      );
    },
    [onSettingsChange],
  );

  const confirmRemove = useCallback(
    async (request: AgentRemovalRequest) => {
      setRemoving(true);
      const res = await removeAgent(request);
      setRemoving(false);
      if (res.ok && res.data) {
        applySettingsSnapshot(
          res.data,
          onSettingsChange,
        );
        setRemovalImpact(null);
        toast.success(`Removed ${request.id}`);
        return;
      }
      toast.error(
        res.error ?? "Failed to remove agent",
      );
    },
    [onSettingsChange],
  );

  return {
    confirmRemove,
    removalImpact,
    removing,
    requestRemove,
    setRemovalImpact,
  };
}

function AddAgentInlineForm({
  onClose,
  onSettingsChange,
}: {
  onClose: () => void;
  onSettingsChange: AgentsSectionProps["onSettingsChange"];
}) {
  return (
    <AddAgentForm
      onAdd={async (id, agent) => {
        const res = await addAgent(id, agent);
        if (res.ok && res.data) {
          onSettingsChange({
            agents: res.data,
          });
          onClose();
          toast.success(`Added ${id}`);
          return;
        }
        toast.error(
          res.error ?? "Failed to add agent",
        );
      }}
      onCancel={onClose}
    />
  );
}

export function SettingsAgentsSection({
  agents,
  onSettingsChange,
}: AgentsSectionProps) {
  const [editingId, setEditingId] =
    useState<string | null>(null);
  const [showAddForm, setShowAddForm] =
    useState(false);
  const {
    scanning,
    scannedAgents,
    handleScan,
    dismissScan,
  } = useAgentScanner();
  const { handleAddScannedOption } =
    useAgentMutations(onSettingsChange);
  const {
    confirmRemove,
    removalImpact,
    removing,
    requestRemove,
    setRemovalImpact,
  } = useAgentRemovalFlow(onSettingsChange);

  const handleToggleOption = useCallback(
    async (agent: ScannedAgent, optionId: string) => {
      const option = (agent.options ?? []).find(
        (candidate) =>
          candidate.id === optionId,
      );
      if (!option) return;
      if (agents[option.id]) {
        await requestRemove(
          option.id,
          `Cleared ${option.label}`,
        );
        return;
      }
      await handleAddScannedOption(agent, option);
    },
    [
      agents,
      handleAddScannedOption,
      requestRemove,
    ],
  );

  return (
    <div className="space-y-3">
      <SectionToolbar
        scanning={scanning}
        onScan={handleScan}
        onAdd={() => setShowAddForm(true)}
      />
      {scannedAgents && (
        <ScannedAgentsList
          scanned={scannedAgents}
          registered={agents}
          onToggleOption={handleToggleOption}
          onClearOption={handleToggleOption}
          onDismiss={dismissScan}
        />
      )}
      {showAddForm && (
        <AddAgentInlineForm
          onClose={() => setShowAddForm(false)}
          onSettingsChange={onSettingsChange}
        />
      )}
      <AgentsList
        editingId={editingId}
        entries={Object.entries(agents)}
        onRemove={requestRemove}
        onSettingsChange={onSettingsChange}
        setEditingId={setEditingId}
      />
      <SettingsAgentRemoveDialog
        agents={agents}
        impact={removalImpact}
        open={removalImpact !== null}
        removing={removing}
        onConfirm={confirmRemove}
        onOpenChange={(open) => {
          if (!open && !removing) {
            setRemovalImpact(null);
          }
        }}
      />
    </div>
  );
}

function AgentsList({
  editingId,
  entries,
  onRemove,
  onSettingsChange,
  setEditingId,
}: {
  editingId: string | null;
  entries: [string, RegisteredAgent][];
  onRemove: (id: string) => void;
  onSettingsChange: AgentsSectionProps["onSettingsChange"];
  setEditingId: (id: string | null) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No agents registered. Use Scan to detect
        installed CLIs or add manually.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map(([id, agent]) => (
        <AgentRow
          key={id}
          agent={agent}
          editing={editingId === id}
          onEdit={() => setEditingId(id)}
          onCancelEdit={() => setEditingId(null)}
          onSave={async (updated) => {
            const res = await addAgent(id, updated);
            if (res.ok && res.data) {
              onSettingsChange({
                agents: res.data,
              });
              setEditingId(null);
              toast.success(`Updated ${id}`);
              return;
            }
            toast.error(
              res.error ?? "Failed to update",
            );
          }}
          onRemove={() => onRemove(id)}
        />
      ))}
    </div>
  );
}

function SectionToolbar({
  scanning,
  onScan,
  onAdd,
}: {
  scanning: boolean;
  onScan: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-end">
      <div className="flex items-center gap-1.5">
        <Button
          variant="success-light"
          size="sm"
          onClick={onScan}
          disabled={scanning}
        >
          <Scan className="mr-1 size-3.5" />
          {scanning ? "Scanning..." : "Scan"}
        </Button>
        <Button
          variant="success"
          size="sm"
          onClick={onAdd}
        >
          <Plus className="mr-1 size-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}
