"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bot, Scan, Plus, Pencil, Trash2, Check, X, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
} from "@/components/ui/command";
import type { RegisteredAgent, ScannedAgent, ScannedAgentOption } from "@/lib/types";
import {
  formatAgentDisplayLabel,
  formatAgentOptionLabel,
} from "@/lib/agent-identity";
import {
  addAgent,
  removeAgent,
  scanAgents,
  saveActions,
} from "@/lib/settings-api";
import type { ActionAgentMappings } from "@/lib/schemas";

function resolveSelectedOption(
  scanned: ScannedAgent,
  selectedOptions: Record<string, string>,
): ScannedAgentOption | null {
  const options = scanned.options ?? [];
  if (options.length === 0) return null;
  const selectedId = selectedOptions[scanned.id] ?? scanned.selectedOptionId ?? options[0]?.id;
  return options.find((option) => option.id === selectedId) ?? options[0] ?? null;
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
  const [selectedScannedOptions, setSelectedScannedOptions] = useState<Record<string, string>>({});

  async function handleScan() {
    setScanning(true);
    try {
      const res = await scanAgents();
      if (res.ok && res.data) {
        setScannedAgents(res.data);
        setSelectedScannedOptions(
          Object.fromEntries(
            res.data.map((agent) => [
              agent.id,
              agent.selectedOptionId ?? agent.options?.[0]?.id ?? "",
            ]),
          ),
        );
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
    const selected = resolveSelectedOption(scanned, selectedScannedOptions);
    if (!selected) {
      toast.error(`No import option available for ${scanned.id}`);
      return;
    }
    const res = await addAgent(selected.id, {
      command: scanned.path,
      provider: selected.provider,
      model: selected.modelId ?? selected.model,
      flavor: selected.flavor,
      version: selected.version,
      label: formatAgentOptionLabel(selected),
    });
    if (res.ok && res.data) {
      onAgentsChange(res.data);
      // If this is the only registered agent, set it as default
      if (Object.keys(res.data).length === 1) {
        await setDefaultAgentForActions(selected.id);
      }
      toast.success(`Added ${selected.label}`);
    } else {
      toast.error(res.error ?? "Failed to add agent");
    }
  }

  async function handleAddAll(unregistered: ScannedAgent[]) {
    const sorted = [...unregistered].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    let latestAgents: Record<string, RegisteredAgent> | undefined;
    let firstAddedId: string | null = null;
    for (const agent of sorted) {
      const selected = resolveSelectedOption(agent, selectedScannedOptions);
      if (!selected) continue;
      const res = await addAgent(selected.id, {
        command: agent.path,
        provider: selected.provider,
        model: selected.modelId ?? selected.model,
        flavor: selected.flavor,
        version: selected.version,
        label: formatAgentOptionLabel(selected),
      });
      if (res.ok && res.data) {
        latestAgents = res.data;
        firstAddedId ??= selected.id;
      } else {
        toast.error(res.error ?? `Failed to add ${agent.id}`);
        return;
      }
    }
    if (latestAgents) {
      onAgentsChange(latestAgents);
      if (firstAddedId) {
        await setDefaultAgentForActions(firstAddedId);
      }
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
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="border-primary/20 bg-background/70 hover:bg-primary/10"
            onClick={handleScan}
            disabled={scanning}
          >
            <Scan className="size-3.5 mr-1" />
            {scanning ? "Scanning..." : "Scan"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-primary/20 bg-background/70 hover:bg-primary/10"
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
          selectedOptions={selectedScannedOptions}
          onSelectOption={(agentId, optionId) =>
            setSelectedScannedOptions((current) => ({
              ...current,
              [agentId]: optionId,
            }))
          }
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
  selectedOptions,
  onSelectOption,
  onAdd,
  onAddAll,
  onDismiss,
}: {
  scanned: ScannedAgent[];
  registered: Record<string, RegisteredAgent>;
  selectedOptions: Record<string, string>;
  onSelectOption: (agentId: string, optionId: string) => void;
  onAdd: (a: ScannedAgent) => void;
  onAddAll: (agents: ScannedAgent[]) => void;
  onDismiss: () => void;
}) {
  const unregisteredInstalled = scanned.filter(
    (agent) => {
      if (!agent.installed) return false;
      const selected = resolveSelectedOption(agent, selectedOptions);
      return selected ? !registered[selected.id] : false;
    },
  );

  return (
    <div className="rounded-xl border border-accent/25 bg-background/65 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Scan Results
        </span>
        <div className="flex items-center gap-1">
          {unregisteredInstalled.length > 1 && (
            <Button
              variant="outline"
              className="border-primary/20 bg-background/70 hover:bg-primary/10"
              size="sm"
              onClick={() => onAddAll(unregisteredInstalled)}
            >
              <Plus className="size-3.5 mr-1" />
              Add All
            </Button>
          )}
          <Button variant="ghost" size="sm" className="hover:bg-primary/10" onClick={onDismiss}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {scanned.map((a) => (
        <ScannedAgentRow
          key={a.id}
          agent={a}
          selectedOption={resolveSelectedOption(a, selectedOptions)}
          isRegistered={Boolean(
            resolveSelectedOption(a, selectedOptions) &&
            registered[resolveSelectedOption(a, selectedOptions)!.id],
          )}
          onSelectOption={(optionId) => onSelectOption(a.id, optionId)}
          onAdd={() => onAdd(a)}
        />
      ))}
    </div>
  );
}

/** Threshold at which we switch from a plain Select to a searchable combobox. */
const SEARCHABLE_THRESHOLD = 10;

/**
 * Find and strip the longest common prefix that ends at a separator
 * (e.g. "/" or ":") so labels stay meaningful but repetitive provider
 * prefixes like "openrouter/anthropic/" are removed.
 */
function stripCommonPrefix(labels: string[]): { stripped: string[]; prefix: string } {
  if (labels.length <= 1) return { stripped: labels, prefix: "" };
  const first = labels[0];
  let prefixLen = first.length;
  for (const label of labels) {
    prefixLen = Math.min(prefixLen, label.length);
    for (let i = 0; i < prefixLen; i++) {
      if (label[i] !== first[i]) {
        prefixLen = i;
        break;
      }
    }
  }
  // Snap back to the last separator so we don't cut mid-word
  const separators = /[/:@.]/;
  let snapIdx = 0;
  for (let i = prefixLen - 1; i >= 0; i--) {
    if (separators.test(first[i])) {
      snapIdx = i + 1; // include the separator in the prefix
      break;
    }
  }
  if (snapIdx <= 1) return { stripped: labels, prefix: "" };
  const prefix = first.slice(0, snapIdx);
  return {
    stripped: labels.map((l) => l.slice(snapIdx)),
    prefix,
  };
}

function SearchableOptionCombobox({
  options,
  value,
  onValueChange,
}: {
  options: ScannedAgentOption[];
  value: string;
  onValueChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Strip common prefixes for shorter display labels
  const rawLabels = options.map((o) => o.label);
  const { stripped, prefix } = stripCommonPrefix(rawLabels);
  const displayMap = new Map(options.map((o, i) => [o.id, stripped[i]]));

  const selectedDisplay = value ? (displayMap.get(value) ?? value) : "select model/version";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-7 min-w-[220px] justify-between border-primary/20 bg-background/80 text-xs font-normal"
        >
          <span className="truncate">{selectedDisplay}</span>
          <ChevronsUpDown className="ml-1 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const display = displayMap.get(option.id) ?? option.label;
                return (
                  <CommandItem
                    key={option.id}
                    value={option.label}
                    onSelect={() => {
                      onValueChange(option.id);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <Check
                      className={`mr-1 size-3 ${option.id === value ? "opacity-100" : "opacity-0"}`}
                    />
                    {display}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ScannedAgentRow({
  agent,
  selectedOption,
  isRegistered,
  onSelectOption,
  onAdd,
}: {
  agent: ScannedAgent;
  selectedOption: ScannedAgentOption | null;
  isRegistered: boolean;
  onSelectOption: (optionId: string) => void;
  onAdd: () => void;
}) {
  const options = agent.options ?? [];
  const useSearchable = options.length >= SEARCHABLE_THRESHOLD;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/10 bg-background/40 px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 font-medium">{agent.provider ?? agent.id}</span>
          {agent.installed ? (
            <Badge
              variant="secondary"
              className="text-[10px] max-w-[220px] truncate [direction:rtl] [text-align:left]"
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
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0">{agent.id}</span>
        {agent.installed && options.length > 0 ? (
          useSearchable ? (
            <SearchableOptionCombobox
              options={options}
              value={selectedOption?.id ?? ""}
              onValueChange={onSelectOption}
            />
          ) : (
            <Select
              value={selectedOption?.id ?? ""}
              onValueChange={onSelectOption}
            >
              <SelectTrigger className="h-7 min-w-[220px] border-primary/20 bg-background/80">
                <SelectValue placeholder="select model/version" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        ) : selectedOption ? (
          <Badge variant="outline" className="text-[10px]">
            {selectedOption.label}
          </Badge>
        ) : null}
      </div>
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
    <div className="flex items-center justify-between rounded-xl border border-primary/15 bg-background/60 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium truncate">
          {formatAgentDisplayLabel(agent) || agent.label || id}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" className="hover:bg-primary/10" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="hover:bg-destructive/10" onClick={onRemove}>
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
    <div className="rounded-xl border border-primary/20 bg-background/65 p-3 space-y-2">
      <div className="grid grid-cols-1 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-xs">Command</Label>
          <Input
            className="h-7 px-2 py-1 text-sm"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
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
        <Button variant="ghost" size="sm" className="hover:bg-primary/10" onClick={onCancel}>
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

