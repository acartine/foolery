"use client";

import { useState } from "react";
import {
  Pencil, Trash2, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RegisteredAgent } from "@/lib/types";
import {
  AgentDisplayLabel,
} from "@/components/agent-display-label";

/* ── Add agent form ──────────────────────────────────── */

export function AddAgentForm({
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
    <div className="rounded-xl border border-primary/20 bg-background/65 p-3 space-y-3">
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
            onChange={(e) =>
              setCommand(e.target.value)
            }
            placeholder="claude"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Model (optional)
          </Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="opus"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Label (optional)
          </Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My Agent"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={
            !id.trim()
            || !command.trim()
            || id.trim() === "default"
          }
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

/* ── Agent row (view/edit) ───────────────────────────── */

export function AgentRow({
  agent,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
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
    <div className="flex items-center justify-between rounded-xl border border-primary/15 bg-background/60 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0 text-xs font-medium">
        <AgentDisplayLabel agent={agent} />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-primary/10"
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-destructive/10"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

/* ── Agent edit row ──────────────────────────────────── */

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
  const [model, setModel] = useState(
    agent.model ?? "",
  );
  const [label, setLabel] = useState(
    agent.label ?? "",
  );

  return (
    <div className="rounded-xl border border-primary/20 bg-background/65 p-3 space-y-2">
      <div className="grid grid-cols-1 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-xs">Command</Label>
          <Input
            className="h-7 px-2 py-1 text-sm"
            value={command}
            onChange={(e) =>
              setCommand(e.target.value)
            }
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-xs">Model</Label>
          <Input
            className="h-7 px-2 py-1 text-sm"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-xs">Label</Label>
          <Input
            className="h-7 px-2 py-1 text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-primary/10"
          onClick={onCancel}
        >
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
