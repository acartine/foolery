"use client";

import { useState } from "react";
import {
  Check, X, ChevronsUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

function formatCredits(credits?: number): string | null {
  if (credits === undefined) return null;
  if (credits === 0) return "free";
  if (credits < 1) return `.${String(credits).split(".")[1]}x`;
  return `${credits}x`;
}

function CreditsBadge({
  credits,
}: {
  credits?: number;
}) {
  const label = formatCredits(credits);
  if (!label) return null;
  return (
    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

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

export function resolveMultiSelectedOptions(
  scanned: ScannedAgent,
  selectedMulti: Record<string, string[]>,
): ScannedAgentOption[] {
  const options = scanned.options ?? [];
  if (options.length === 0) return [];
  const selectedIds = selectedMulti[scanned.id] ?? [];
  return options.filter((opt) => selectedIds.includes(opt.id));
}

export function resolveRegisteredOptionIds(
  scanned: ScannedAgent,
  registered: Record<string, RegisteredAgent>,
): string[] {
  const options = scanned.options ?? [];
  return options
    .filter((option) => Boolean(registered[option.id]))
    .map((option) => option.id);
}

/* ── Scanned agents list ─────────────────────────────── */

export function ScannedAgentsList({
  scanned,
  registered,
  onToggleOption,
  onClearOption,
  onDismiss,
}: {
  scanned: ScannedAgent[];
  registered: Record<string, RegisteredAgent>;
  onToggleOption: (
    agent: ScannedAgent,
    optionId: string,
  ) => void;
  onClearOption: (
    agent: ScannedAgent,
    optionId: string,
  ) => void;
  onDismiss: () => void;
}) {
  return (
    <div className={
      "rounded-xl border border-accent/25 "
      + "bg-background/65 p-3 space-y-2"
    }>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Scan Results
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-primary/10"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {scanned.map((a) => (
        <ScannedAgentRow
          key={a.id}
          agent={a}
          registered={registered}
          selectedIds={resolveRegisteredOptionIds(
            a,
            registered,
          )}
          onToggleOption={(optionId) =>
            onToggleOption(a, optionId)
          }
          onClearOption={(optionId) =>
            onClearOption(a, optionId)
          }
        />
      ))}
    </div>
  );
}

/* ── Multi-select model combobox ─────────────────────── */

export function filterSearchableOption(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch.length === 0) return 1;

  const matchesValue = value
    .toLowerCase()
    .includes(normalizedSearch);
  if (matchesValue) return 1;

  return keywords?.some((keyword) =>
    keyword.toLowerCase().includes(normalizedSearch),
  )
    ? 1
    : 0;
}

function MultiSelectModelCombobox({
  options,
  displayMap,
  selectedIds,
  onToggle,
}: {
  options: ScannedAgentOption[];
  displayMap: Map<string, string>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selectedIds.length;
  const summary = count === 0
    ? "select models"
    : `${count} model${count > 1 ? "s" : ""} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={
            "h-7 min-w-[180px] justify-between "
            + "border-primary/20 bg-background/80 "
            + "text-xs font-normal"
          }
        >
          <span className="truncate">{summary}</span>
          <ChevronsUpDown className={
            "ml-1 size-3 shrink-0 opacity-50"
          } />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-0"
        align="start"
      >
        <Command filter={filterSearchableOption}>
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
                const isSelected =
                  selectedIds.includes(option.id);
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
                    onSelect={() => onToggle(option.id)}
                    className="text-xs"
                  >
                    <Check
                      className={`mr-1 size-3 ${isSelected ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="flex-1 truncate">
                      {display}
                    </span>
                    <CreditsBadge
                      credits={option.credits}
                    />
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

/* ── Selected model pills ────────────────────────────── */

function SelectedModelPills({
  options,
  selectedIds,
  displayMap,
  onClear,
}: {
  options: ScannedAgentOption[];
  selectedIds: string[];
  displayMap: Map<string, string>;
  onClear: (id: string) => void;
}) {
  if (selectedIds.length === 0) return null;
  const selected = options.filter(
    (o) => selectedIds.includes(o.id),
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.map((opt) => (
        <Badge
          key={opt.id}
          variant="secondary"
          className={
            "flex items-center gap-1 text-[10px] "
            + "px-1.5 py-0 h-4 font-normal shrink-0"
          }
        >
          <span>
            {displayMap.get(opt.id) ?? opt.label}
          </span>
          <button
            type="button"
            aria-label={`Clear ${displayMap.get(opt.id) ?? opt.label}`}
            className="rounded-sm opacity-70 transition hover:opacity-100"
            onClick={() => onClear(opt.id)}
          >
            <X className="size-2.5" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

/* ── Scanned agent row ───────────────────────────────── */

function ScannedAgentRow({
  agent,
  registered,
  selectedIds,
  onToggleOption,
  onClearOption,
}: {
  agent: ScannedAgent;
  registered: Record<string, RegisteredAgent>;
  selectedIds: string[];
  onToggleOption: (optionId: string) => void;
  onClearOption: (optionId: string) => void;
}) {
  const options = agent.options ?? [];
  const displayMap = buildModelLabelDisplayMap(options);
  void registered;

  return (
    <div className={
      "flex flex-col gap-2 rounded-lg border "
      + "border-primary/10 bg-background/40 "
      + "px-2.5 py-2 text-xs"
    }>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="shrink-0 font-medium">
            {agent.provider ?? agent.id}
          </span>
          {agent.installed ? (
            <span
              className={
                "text-[10px] text-muted-foreground "
                + "truncate max-w-[300px]"
              }
              title={agent.path}
            >
              {agent.path}
            </span>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] w-fit"
            >
              not found
            </Badge>
          )}
        </div>
        <SelectedModelPills
          options={options}
          selectedIds={selectedIds}
          displayMap={displayMap}
          onClear={onClearOption}
        />
      </div>
      {agent.installed && options.length > 0 && (
        <MultiSelectModelCombobox
          options={options}
          displayMap={displayMap}
          selectedIds={selectedIds}
          onToggle={onToggleOption}
        />
      )}
    </div>
  );
}
