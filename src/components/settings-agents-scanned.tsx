"use client";

import { useState } from "react";
import {
  Plus, Check, X, ChevronsUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type {
  RegisteredAgent,
  ScannedAgent,
  ScannedAgentOption,
} from "@/lib/types";
import { buildModelLabelDisplayMap } from "@/lib/model-labels";

export function resolveSelectedOption(
  scanned: ScannedAgent,
  selectedOptions: Record<string, string>,
): ScannedAgentOption | null {
  const options = scanned.options ?? [];
  if (options.length === 0) return null;
  const selectedId =
    selectedOptions[scanned.id]
    ?? scanned.selectedOptionId
    ?? options[0]?.id;
  return (
    options.find((option) => option.id === selectedId)
    ?? options[0]
    ?? null
  );
}

/* ── Scanned agents list ─────────────────────────────── */

export function ScannedAgentsList({
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
  onSelectOption: (
    agentId: string,
    optionId: string,
  ) => void;
  onAdd: (a: ScannedAgent) => void;
  onAddAll: (agents: ScannedAgent[]) => void;
  onDismiss: () => void;
}) {
  const unregisteredInstalled = scanned.filter(
    (agent) => {
      if (!agent.installed) return false;
      const selected = resolveSelectedOption(
        agent,
        selectedOptions,
      );
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
          <Button
            variant="ghost"
            size="sm"
            className="hover:bg-primary/10"
            onClick={onDismiss}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {scanned.map((a) => (
        <ScannedAgentRow
          key={a.id}
          agent={a}
          selectedOption={resolveSelectedOption(
            a,
            selectedOptions,
          )}
          isRegistered={Boolean(
            resolveSelectedOption(a, selectedOptions)
            && registered[
              resolveSelectedOption(
                a,
                selectedOptions,
              )!.id
            ],
          )}
          onSelectOption={(optionId) =>
            onSelectOption(a.id, optionId)
          }
          onAdd={() => onAdd(a)}
        />
      ))}
    </div>
  );
}

/* ── Searchable option combobox ──────────────────────── */

const SEARCHABLE_THRESHOLD = 10;

function SearchableOptionCombobox({
  options,
  displayMap,
  value,
  onValueChange,
}: {
  options: ScannedAgentOption[];
  displayMap: Map<string, string>;
  value: string;
  onValueChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedDisplay = value
    ? (displayMap.get(value) ?? value)
    : "select model/version";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-7 min-w-[220px] justify-between border-primary/20 bg-background/80 text-xs font-normal"
        >
          <span className="truncate">
            {selectedDisplay}
          </span>
          <ChevronsUpDown className="ml-1 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search models..."
            className="h-8 text-xs"
          />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const display =
                  displayMap.get(option.id)
                  ?? option.label;
                return (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    keywords={[
                      option.label,
                      display !== option.label
                        ? display
                        : undefined,
                      option.provider,
                      option.model,
                      option.modelId,
                      option.flavor,
                      option.version,
                    ].filter(
                      (term): term is string =>
                        Boolean(term),
                    )}
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

/* ── Scanned agent row ───────────────────────────────── */

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
  const useSearchable =
    options.length >= SEARCHABLE_THRESHOLD;
  const displayMap = buildModelLabelDisplayMap(options);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/10 bg-background/40 px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 font-medium">
            {agent.provider ?? agent.id}
          </span>
          {agent.installed ? (
            <Badge
              variant="secondary"
              className="text-[10px] max-w-[220px] truncate [direction:rtl] [text-align:left]"
              title={agent.path}
            >
              {agent.path}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px]"
            >
              not found
            </Badge>
          )}
        </div>
        {agent.installed && !isRegistered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAdd}
          >
            <Plus className="size-3.5 mr-1" />
            Add
          </Button>
        )}
        {agent.installed && isRegistered && (
          <Badge
            variant="outline"
            className="text-[10px]"
          >
            registered
          </Badge>
        )}
      </div>
      {renderOptionSelector(
        agent,
        options,
        useSearchable,
        displayMap,
        selectedOption,
        onSelectOption,
      )}
    </div>
  );
}

function renderOptionSelector(
  agent: ScannedAgent,
  options: ScannedAgentOption[],
  useSearchable: boolean,
  displayMap: Map<string, string>,
  selectedOption: ScannedAgentOption | null,
  onSelectOption: (optionId: string) => void,
) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="shrink-0">{agent.id}</span>
      {agent.installed && options.length > 0 ? (
        useSearchable ? (
          <SearchableOptionCombobox
            options={options}
            displayMap={displayMap}
            value={selectedOption?.id ?? ""}
            onValueChange={onSelectOption}
          />
        ) : (
          <Select
            value={selectedOption?.id ?? ""}
            onValueChange={onSelectOption}
          >
            <SelectTrigger className="h-7 min-w-[220px] border-primary/20 bg-background/80">
              <SelectValue
                placeholder="select model/version"
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={option.id}
                  value={option.id}
                >
                  {displayMap.get(option.id)
                    ?? option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      ) : selectedOption ? (
        <Badge
          variant="outline"
          className="text-[10px]"
        >
          {selectedOption.label}
        </Badge>
      ) : null}
    </div>
  );
}
