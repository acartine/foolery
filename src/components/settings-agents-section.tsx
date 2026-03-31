"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Scan, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  RegisteredAgent,
  ScannedAgent,
} from "@/lib/types";
import { addAgent } from "@/lib/settings-api";
import {
  ScannedAgentsList,
} from "@/components/settings-agents-scanned";
import {
  AddAgentForm,
  AgentRow,
} from "@/components/settings-agents-forms";
import {
  useAgentScanner,
  useAgentMutations,
} from "@/components/settings-agents-hooks";

interface AgentsSectionProps {
  agents: Record<string, RegisteredAgent>;
  onAgentsChange: (
    agents: Record<string, RegisteredAgent>,
  ) => void;
}

export function SettingsAgentsSection({
  agents,
  onAgentsChange,
}: AgentsSectionProps) {
  const [showAddForm, setShowAddForm] =
    useState(false);
  const [editingId, setEditingId] =
    useState<string | null>(null);

  const {
    scanning,
    scannedAgents,
    handleScan,
    dismissScan,
  } = useAgentScanner();

  const {
    handleAddScannedOption,
    handleRemoveScannedOption,
    handleRemove,
  } = useAgentMutations(onAgentsChange);

  const handleToggleOption = useCallback(
    async (agent: ScannedAgent, optionId: string) => {
      const options = agent.options ?? [];
      const option = options.find(
        (o) => o.id === optionId,
      );
      if (!option) return;
      if (agents[option.id]) {
        await handleRemoveScannedOption(
          option.id,
          option.label,
        );
        return;
      }
      await handleAddScannedOption(agent, option);
    },
    [
      agents,
      handleAddScannedOption,
      handleRemoveScannedOption,
    ],
  );

  const agentEntries = Object.entries(agents);

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
        <AddAgentForm
          onAdd={async (id, agent) => {
            const res = await addAgent(
              id,
              agent,
            );
            if (res.ok && res.data) {
              onAgentsChange(res.data);
              setShowAddForm(false);
              toast.success(`Added ${id}`);
            } else {
              toast.error(
                res.error
                  ?? "Failed to add agent",
              );
            }
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <AgentsList
        entries={agentEntries}
        editingId={editingId}
        onAgentsChange={onAgentsChange}
        setEditingId={setEditingId}
        onRemove={handleRemove}
      />
    </div>
  );
}

/* ── Agent list ──────────────────────────────────────── */

function AgentsList({
  entries,
  editingId,
  onAgentsChange,
  setEditingId,
  onRemove,
}: {
  entries: [string, RegisteredAgent][];
  editingId: string | null;
  onAgentsChange: (
    agents: Record<string, RegisteredAgent>,
  ) => void;
  setEditingId: (id: string | null) => void;
  onRemove: (id: string) => void;
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
            const res = await addAgent(
              id,
              updated,
            );
            if (res.ok && res.data) {
              onAgentsChange(res.data);
              setEditingId(null);
              toast.success(`Updated ${id}`);
            } else {
              toast.error(
                res.error
                  ?? "Failed to update",
              );
            }
          }}
          onRemove={() => onRemove(id)}
        />
      ))}
    </div>
  );
}

/* ── Section toolbar ─────────────────────────────────── */

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
          <Scan className="size-3.5 mr-1" />
          {scanning ? "Scanning..." : "Scan"}
        </Button>
        <Button
          variant="success"
          size="sm"
          onClick={onAdd}
        >
          <Plus className="size-3.5 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
