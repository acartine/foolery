"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bot, Scan, Plus, Pencil, Trash2, Check, X, Globe, Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { RegisteredAgent, ScannedAgent } from "@/lib/types";
import type { OpenRouterModel } from "@/lib/openrouter";
import {
  formatPricing,
  formatOpenRouterAgentLabel,
} from "@/lib/openrouter";
import {
  addAgent,
  removeAgent,
  scanAgents,
  saveActions,
  patchSettings,
  fetchOpenRouterModels as fetchModelsApi,
  validateOpenRouterKey,
} from "@/lib/settings-api";
import { formatModelDisplay } from "@/hooks/use-agent-info";
import type { ActionAgentMappings, OpenRouterSettings } from "@/lib/schemas";

const KNOWN_AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "OpenAI Codex",
  chatgpt: "OpenAI ChatGPT",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
};

function defaultAgentLabel(id: string): string {
  return KNOWN_AGENT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

async function setDefaultAgentForActions(agentId: string) {
  const mappings: ActionAgentMappings = {
    take: agentId,
    scene: agentId,
    breakdown: agentId,
  };
  await saveActions(mappings);
}

interface AgentsSectionProps {
  agents: Record<string, RegisteredAgent>;
  onAgentsChange: (agents: Record<string, RegisteredAgent>) => void;
  openrouter: OpenRouterSettings;
  onOpenRouterChange: (openrouter: OpenRouterSettings) => void;
}

export function SettingsAgentsSection({
  agents,
  onAgentsChange,
  openrouter,
  onOpenRouterChange,
}: AgentsSectionProps) {
  const [scanning, setScanning] = useState(false);
  const [scannedAgents, setScannedAgents] = useState<ScannedAgent[] | null>(
    null,
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showOpenRouterPanel, setShowOpenRouterPanel] = useState(false);

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
      label: defaultAgentLabel(scanned.id),
    });
    if (res.ok && res.data) {
      onAgentsChange(res.data);
      // If this is the only registered agent, set it as default
      if (Object.keys(res.data).length === 1) {
        await setDefaultAgentForActions(scanned.id);
      }
      toast.success(`Added ${scanned.id}`);
    } else {
      toast.error(res.error ?? "Failed to add agent");
    }
  }

  async function handleAddAll(unregistered: ScannedAgent[]) {
    const sorted = [...unregistered].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    let latestAgents: Record<string, RegisteredAgent> | undefined;
    for (const agent of sorted) {
      const res = await addAgent(agent.id, {
        command: agent.path,
        label: defaultAgentLabel(agent.id),
      });
      if (res.ok && res.data) {
        latestAgents = res.data;
      } else {
        toast.error(res.error ?? `Failed to add ${agent.id}`);
        return;
      }
    }
    if (latestAgents) {
      onAgentsChange(latestAgents);
      await setDefaultAgentForActions(sorted[0].id);
      toast.success(`Added ${sorted.length} agent(s)`);
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
          <Bot className="size-4 text-primary" />
          <h3 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-sm font-medium text-transparent">
            Agents
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-primary/55 bg-gradient-to-r from-primary/22 to-accent/16 shadow-sm shadow-primary/15 hover:from-primary/30 hover:to-accent/24"
            onClick={handleScan}
            disabled={scanning}
          >
            <Scan className="size-3.5 mr-1" />
            {scanning ? "Scanning..." : "Scan"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-accent/55 bg-gradient-to-r from-accent/22 to-primary/18 shadow-sm shadow-accent/15 hover:from-accent/30 hover:to-primary/26"
            onClick={() => setShowOpenRouterPanel(!showOpenRouterPanel)}
          >
            <Globe className="size-3.5 mr-1" />
            OpenRouter
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-primary/50 bg-gradient-to-r from-primary/18 via-background/85 to-accent/18 hover:border-accent/60 hover:from-primary/24 hover:to-accent/24"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="size-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {showOpenRouterPanel && (
        <OpenRouterAgentPanel
          openrouter={openrouter}
          onOpenRouterChange={onOpenRouterChange}
          onClose={() => setShowOpenRouterPanel(false)}
        />
      )}

      {scannedAgents && (
        <ScannedAgentsList
          scanned={scannedAgents}
          registered={agents}
          onAdd={handleAddScanned}
          onAddAll={handleAddAll}
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

      {agentEntries.length === 0 && Object.keys(openrouter.agents).length === 0 ? (
        <div className="rounded-lg border border-primary/50 bg-gradient-to-r from-primary/20 via-background/80 to-accent/20 p-3 ring-1 ring-primary/18">
          <p className="text-xs text-muted-foreground">
            No agents registered. Use Scan to detect installed CLIs, add
            manually, or add from OpenRouter.
          </p>
        </div>
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
          {openrouter.enabled && Object.entries(openrouter.agents).map(([key, entry]) => (
            <OpenRouterAgentRow
              key={`or-${key}`}
              agentKey={key}
              model={entry.model}
              label={entry.label}
              onRemove={() => {
                const next = { ...openrouter.agents };
                delete next[key];
                const updated = { ...openrouter, agents: next };
                onOpenRouterChange(updated);
                patchSettings({ openrouter: updated }).catch(() =>
                  toast.error("Failed to save")
                );
              }}
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
  onAddAll,
  onDismiss,
}: {
  scanned: ScannedAgent[];
  registered: Record<string, RegisteredAgent>;
  onAdd: (a: ScannedAgent) => void;
  onAddAll: (agents: ScannedAgent[]) => void;
  onDismiss: () => void;
}) {
  const unregisteredInstalled = scanned.filter(
    (a) => a.installed && !registered[a.id],
  );

  return (
    <div className="rounded-lg border border-accent/50 bg-gradient-to-r from-accent/20 via-background/80 to-primary/20 p-3 space-y-2 ring-1 ring-accent/18">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Scan Results
        </span>
        <div className="flex items-center gap-1">
          {unregisteredInstalled.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddAll(unregisteredInstalled)}
            >
              <Plus className="size-3.5 mr-1" />
              Add All
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {scanned.map((a) => (
        <ScannedAgentRow
          key={a.id}
          agent={a}
          isRegistered={!!registered[a.id]}
          onAdd={() => onAdd(a)}
        />
      ))}
    </div>
  );
}

function ScannedAgentRow({
  agent,
  isRegistered,
  onAdd,
}: {
  agent: ScannedAgent;
  isRegistered: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0">{agent.id}</span>
        {agent.installed ? (
          <Badge
            variant="secondary"
            className="text-[10px] max-w-[200px] truncate [direction:rtl] [text-align:left]"
            title={agent.path}
          >
            {agent.path}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            not found
          </Badge>
        )}
      </div>
      {agent.installed && !isRegistered && (
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus className="size-3.5 mr-1" />
          Add
        </Button>
      )}
      {agent.installed && isRegistered && (
        <Badge variant="outline" className="text-[10px]">
          registered
        </Badge>
      )}
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
    <div className="rounded-lg border border-primary/50 bg-gradient-to-r from-primary/20 via-background/85 to-accent/20 p-3 space-y-3 ring-1 ring-primary/18">
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
    <div className="flex items-center justify-between rounded-lg border border-primary/45 bg-gradient-to-r from-primary/18 via-background/84 to-accent/20 px-3 py-2 transition-all hover:-translate-y-0.5 hover:border-accent/65 hover:shadow-sm hover:shadow-accent/20">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">
          {agent.label ?? id}
        </span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {agent.command}
        </Badge>
        {agent.model && (
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {formatModelDisplay(agent.model)}
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
    <div className="rounded-lg border border-primary/50 bg-gradient-to-r from-primary/20 via-background/85 to-accent/18 p-3 space-y-2 ring-1 ring-primary/18">
      <div className="grid grid-cols-1 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-xs">Command</Label>
          <Input
            className="h-7 border-primary/55 bg-gradient-to-r from-primary/20 via-background/84 to-accent/16 px-2 py-1 text-sm"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-xs">Model</Label>
          <Input
            className="h-7 border-primary/55 bg-gradient-to-r from-primary/20 via-background/84 to-accent/16 px-2 py-1 text-sm"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-xs">Label</Label>
          <Input
            className="h-7 border-primary/55 bg-gradient-to-r from-primary/20 via-background/84 to-accent/16 px-2 py-1 text-sm"
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

/* ── OpenRouter agent row (read-only display) ────────────── */

function OpenRouterAgentRow({
  agentKey,
  model,
  label,
  onRemove,
}: {
  agentKey: string;
  model: string;
  label: string;
  onRemove: () => void;
}) {
  const displayLabel = formatOpenRouterAgentLabel(agentKey, label, model);
  return (
    <div className="flex items-center justify-between rounded-lg border border-accent/60 bg-gradient-to-r from-accent/30 via-background/78 to-primary/26 px-3 py-2 ring-1 ring-accent/25 shadow-sm shadow-accent/20">
      <div className="flex items-center gap-2 min-w-0">
        <Globe className="size-3.5 text-accent shrink-0" />
        <span className="text-sm font-medium truncate">{displayLabel}</span>
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {model}
        </Badge>
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </div>
  );
}

/* ── OpenRouter agent panel (API key + model browser) ────── */

function OpenRouterAgentPanel({
  openrouter,
  onOpenRouterChange,
  onClose,
}: {
  openrouter: OpenRouterSettings;
  onOpenRouterChange: (or: OpenRouterSettings) => void;
  onClose: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isMasked = openrouter.apiKey.includes("...");

  async function handleValidate() {
    if (!openrouter.apiKey.trim()) {
      toast.error("Enter an API key first");
      return;
    }
    setValidating(true);
    setKeyValid(null);
    try {
      const res = await validateOpenRouterKey(openrouter.apiKey);
      if (res.ok && res.data?.valid) {
        setKeyValid(true);
        toast.success("API key is valid");
      } else {
        setKeyValid(false);
        toast.error("API key is invalid");
      }
    } catch {
      toast.error("Validation request failed");
    } finally {
      setValidating(false);
    }
  }

  async function handleLoadModels() {
    setLoadingModels(true);
    try {
      const res = await fetchModelsApi();
      if (res.ok && res.data) {
        setModels(res.data);
        toast.success(`Loaded ${res.data.length} models`);
      } else {
        toast.error(res.error ?? "Failed to load models");
      }
    } catch {
      toast.error("Failed to fetch models");
    } finally {
      setLoadingModels(false);
    }
  }

  function toggleModel(modelId: string) {
    const next = new Set(selected);
    if (next.has(modelId)) {
      next.delete(modelId);
    } else {
      next.add(modelId);
    }
    setSelected(next);
  }

  async function handleAddSelected() {
    if (selected.size === 0) return;
    const nextAgents = { ...openrouter.agents };
    const existingModelIds = new Set(
      Object.values(nextAgents)
        .map((agent) => normalizeModelId(agent.model))
        .filter(Boolean),
    );
    let addedCount = 0;
    for (const modelId of selected) {
      const normalizedModelId = normalizeModelId(modelId);
      if (!normalizedModelId || existingModelIds.has(normalizedModelId)) {
        continue;
      }
      const key = modelId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const matchedModel = models?.find((m) => m.id === modelId);
      nextAgents[key] = {
        model: modelId,
        label: matchedModel?.name ?? modelId,
      };
      existingModelIds.add(normalizedModelId);
      addedCount += 1;
    }
    if (addedCount === 0) {
      toast.info("Selected OpenRouter models are already registered");
      setSelected(new Set());
      return;
    }
    const updated: OpenRouterSettings = {
      ...openrouter,
      enabled: true,
      agents: nextAgents,
    };
    onOpenRouterChange(updated);
    try {
      await patchSettings({ openrouter: updated });
      toast.success(`Added ${addedCount} OpenRouter model(s)`);
      setSelected(new Set());
    } catch {
      toast.error("Failed to save");
    }
  }

  const filteredModels = models?.filter(
    (m) =>
      m.name.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase()),
  );

  return (
    <div className="rounded-lg border border-accent/65 bg-gradient-to-br from-accent/30 via-background/74 to-primary/32 p-3 space-y-3 shadow-md shadow-accent/25 ring-1 ring-accent/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-accent drop-shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
          <span className="bg-gradient-to-r from-accent to-primary bg-clip-text text-xs font-medium text-transparent">
            Add from OpenRouter
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-primary/15 hover:text-primary"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">API Key</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showKey ? "text" : "password"}
              value={openrouter.apiKey}
              onChange={(e) =>
                onOpenRouterChange({ ...openrouter, apiKey: e.target.value })
              }
              placeholder="sk-or-v1-..."
              className="border-primary/65 bg-gradient-to-r from-primary/20 via-background/82 to-accent/18 pr-9 ring-1 ring-primary/15"
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-2 hover:bg-primary/15 hover:text-primary"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-accent/65 bg-gradient-to-r from-accent/22 to-primary/18 hover:from-accent/30 hover:to-primary/24"
            onClick={handleValidate}
            disabled={validating || !openrouter.apiKey.trim()}
          >
            {validating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : keyValid === true ? (
              <CheckCircle2 className="size-3.5 text-green-500" />
            ) : (
              "Validate"
            )}
          </Button>
        </div>
        {isMasked && (
          <p className="text-[10px] text-muted-foreground">
            Key is stored server-side. Clear and type a new key to update.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Models</Label>
          <Button
            variant="outline"
            size="sm"
            className="border-primary/65 bg-gradient-to-r from-primary/22 to-accent/18 hover:from-primary/30 hover:to-accent/24"
            onClick={handleLoadModels}
            disabled={loadingModels}
          >
            {loadingModels ? (
              <>
                <Loader2 className="size-3.5 mr-1 animate-spin" />
                Loading...
              </>
            ) : models ? "Refresh" : "Browse Models"}
          </Button>
        </div>

        {models && (
          <div className="space-y-2">
            <Input
              placeholder="Filter models..."
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="h-7 border-primary/60 bg-gradient-to-r from-primary/20 via-background/82 to-accent/18 text-xs"
            />
            <div className="max-h-[200px] overflow-y-auto rounded-lg border border-primary/55 bg-gradient-to-br from-primary/16 via-background/78 to-accent/14 ring-1 ring-primary/22">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 border-b border-primary/35 bg-gradient-to-r from-primary/20 via-background to-accent/18">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium w-6"></th>
                    <th className="px-2 py-1.5 font-medium">Model</th>
                    <th className="px-2 py-1.5 font-medium text-right">Prompt</th>
                    <th className="px-2 py-1.5 font-medium text-right">Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredModels ?? []).map((model) => {
                    const isSelected = selected.has(model.id);
                    const alreadyAdded = Object.values(openrouter.agents).some(
                      (a) => normalizeModelId(a.model) === normalizeModelId(model.id),
                    );
                    return (
                      <tr
                        key={model.id}
                        role="button"
                        tabIndex={0}
                        className={`border-b border-border/50 cursor-pointer transition-colors ${
                          alreadyAdded
                            ? "opacity-50"
                            : isSelected
                            ? "bg-gradient-to-r from-primary/24 to-accent/22 hover:from-primary/30 hover:to-accent/28"
                            : "hover:bg-accent/16"
                        }`}
                        onClick={() => !alreadyAdded && toggleModel(model.id)}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && !alreadyAdded) {
                            e.preventDefault();
                            toggleModel(model.id);
                          }
                        }}
                      >
                        <td className="px-2 py-1.5">
                          {alreadyAdded ? (
                            <Check className="size-3 text-green-500" />
                          ) : isSelected ? (
                            <Check className="size-3 text-primary" />
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium truncate max-w-[180px]" title={model.id}>
                            {model.name}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Badge variant="secondary" className="text-[9px] font-mono">
                            {formatPricing(model.pricing.prompt)}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Badge variant="secondary" className="text-[9px] font-mono">
                            {formatPricing(model.pricing.completion)}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(filteredModels ?? []).length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No models match filter
                </p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                {selected.size} selected
              </p>
              <Button
                size="sm"
                className="bg-gradient-to-r from-primary to-accent text-primary-foreground"
                disabled={selected.size === 0}
                onClick={handleAddSelected}
              >
                <Plus className="size-3.5 mr-1" />
                Add Selected
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
