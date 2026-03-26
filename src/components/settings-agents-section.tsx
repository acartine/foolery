"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Scan, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RegisteredAgent } from "@/lib/types";
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
    selectedScannedOptions,
    setSelectedScannedOptions,
    handleScan,
    dismissScan,
  } = useAgentScanner();

  const {
    handleAddScanned,
    handleAddAll,
    handleRemove,
  } = useAgentMutations(
    onAgentsChange,
    selectedScannedOptions,
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
          selectedOptions={
            selectedScannedOptions
          }
          onSelectOption={(agentId, optId) =>
            setSelectedScannedOptions((p) => ({
              ...p,
              [agentId]: optId,
            }))
          }
          onAdd={handleAddScanned}
          onAddAll={handleAddAll}
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
          variant="outline"
          size="sm"
          className="border-primary/20 bg-background/70 hover:bg-primary/10"
          onClick={onScan}
          disabled={scanning}
        >
          <Scan className="size-3.5 mr-1" />
          {scanning ? "Scanning..." : "Scan"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-primary/20 bg-background/70 hover:bg-primary/10"
          onClick={onAdd}
        >
          <Plus className="size-3.5 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
