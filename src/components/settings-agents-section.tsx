"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bot, Scan, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { RegisteredAgent, ScannedAgent } from "@/lib/types";
import {
  addAgent,
  removeAgent,
  scanAgents,
} from "@/lib/settings-api";

interface AgentsSectionProps {
  agents: Record<string, RegisteredAgent>;
  onAgentsChange: (agents: Record<string, RegisteredAgent>) => void;
}

export function SettingsAgentsSection({
  agents,
  onAgentsChange,
}: AgentsSectionProps) {
  const [scanning, setScanning] = useState(false);
  const [scannedAgents, setScannedAgents] = useState<ScannedAgent[] | null>(
    null,
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    try {
      const res = await scanAgents();
      if (res.ok && res.data) {
        setScannedAgents(res.data);
        const installed = res.data.filter((a) => a.installed);
        if (installed.length === 0) {
          toast.info("No agent CLIs found on PATH");
        } else {
          toast.success(`Found ${installed.length} agent CLI(s)`);
        }
      } else {
        toast.error(res.error ?? "Scan failed");
      }
    } catch {
      toast.error("Failed to scan for agents");
    } finally {
      setScanning(false);
    }
  }

  async function handleAddScanned(scanned: ScannedAgent) {
    const res = await addAgent(scanned.id, {
      command: scanned.path,
      label: scanned.id.charAt(0).toUpperCase() + scanned.id.slice(1),
    });
    if (res.ok && res.data) {
      onAgentsChange(res.data);
      toast.success(`Added ${scanned.id}`);
    } else {
      toast.error(res.error ?? "Failed to add agent");
    }
  }

  async function handleRemove(id: string) {
    const res = await removeAgent(id);
    if (res.ok && res.data) {
      onAgentsChange(res.data);
      toast.success(`Removed ${id}`);
    } else {
      toast.error(res.error ?? "Failed to remove agent");
    }
  }

  const agentEntries = Object.entries(agents);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Agents</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={scanning}
          >
            <Scan className="size-3.5 mr-1" />
            {scanning ? "Scanning..." : "Scan"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="size-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {scannedAgents && (
        <ScannedAgentsList
          scanned={scannedAgents}
          registered={agents}
          onAdd={handleAddScanned}
          onDismiss={() => setScannedAgents(null)}
        />
      )}

      {showAddForm && (
        <AddAgentForm
          onAdd={async (id, agent) => {
            const res = await addAgent(id, agent);
            if (res.ok && res.data) {
              onAgentsChange(res.data);
              setShowAddForm(false);
              toast.success(`Added ${id}`);
            } else {
              toast.error(res.error ?? "Failed to add agent");
            }
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {agentEntries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agents registered. Use Scan to detect installed CLIs or add
          manually.
        </p>
      ) : (
        <div className="space-y-2">
          {agentEntries.map(([id, agent]) => (
            <AgentRow
              key={id}
              id={id}
              agent={agent}
              editing={editingId === id}
              onEdit={() => setEditingId(id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={async (updated) => {
                const res = await addAgent(id, updated);
                if (res.ok && res.data) {
                  onAgentsChange(res.data);
                  setEditingId(null);
                  toast.success(`Updated ${id}`);
                } else {
                  toast.error(res.error ?? "Failed to update agent");
                }
              }}
              onRemove={() => handleRemove(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Scanned agents list ──────────────────────────────────── */

function ScannedAgentsList({
  scanned,
  registered,
  onAdd,
  onDismiss,
}: {
  scanned: ScannedAgent[];
  registered: Record<string, RegisteredAgent>;
  onAdd: (a: ScannedAgent) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Scan Results
        </span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          <X className="size-3.5" />
        </Button>
      </div>
      {scanned.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between text-sm"
        >
          <div className="flex items-center gap-2">
            <span>{a.id}</span>
            {a.installed ? (
              <Badge variant="secondary" className="text-[10px]">
                {a.path}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                not found
              </Badge>
            )}
          </div>
          {a.installed && !registered[a.id] && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAdd(a)}
            >
              <Plus className="size-3.5 mr-1" />
              Add
            </Button>
          )}
          {a.installed && registered[a.id] && (
            <Badge variant="outline" className="text-[10px]">
              registered
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Add agent form ───────────────────────────────────────── */

function AddAgentForm({
  onAdd,
  onCancel,
}: {
  onAdd: (id: string, agent: RegisteredAgent) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");

  return (
    <div className="rounded-md border p-3 space-y-3">
      <span className="text-xs font-medium text-muted-foreground">
        New Agent
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">ID</Label>
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="my-agent"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Command</Label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="claude"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model (optional)</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="opus"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Label (optional)</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My Agent"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!id.trim() || !command.trim() || id.trim() === "default"}
          onClick={() =>
            onAdd(id.trim(), {
              command: command.trim(),
              model: model.trim() || undefined,
              label: label.trim() || undefined,
            })
          }
        >
          Add Agent
        </Button>
      </div>
    </div>
  );
}

/* ── Agent row (view/edit) ────────────────────────────────── */

function AgentRow({
  id,
  agent,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  id: string;
  agent: RegisteredAgent;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updated: RegisteredAgent) => void;
  onRemove: () => void;
}) {
  if (editing) {
    return (
      <AgentEditRow
        agent={agent}
        onSave={onSave}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">
          {agent.label ?? id}
        </span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {agent.command}
        </Badge>
        {agent.model && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {agent.model}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function AgentEditRow({
  agent,
  onSave,
  onCancel,
}: {
  agent: RegisteredAgent;
  onSave: (updated: RegisteredAgent) => void;
  onCancel: () => void;
}) {
  const [command, setCommand] = useState(agent.command);
  const [model, setModel] = useState(agent.model ?? "");
  const [label, setLabel] = useState(agent.label ?? "");

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Command</Label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-3.5" />
        </Button>
        <Button
          size="sm"
          disabled={!command.trim()}
          onClick={() =>
            onSave({
              command: command.trim(),
              model: model.trim() || undefined,
              label: label.trim() || undefined,
            })
          }
        >
          <Check className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
