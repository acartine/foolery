"use client";

import {
  ChevronDown,
  ListMusic,
  Tag,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  OverviewSetlistFilterOption,
  OverviewTagFilterOption,
} from "@/lib/beat-state-overview-filters";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BeatOverviewFilterToolbarProps {
  tagOptions: readonly OverviewTagFilterOption[];
  setlistOptions: readonly OverviewSetlistFilterOption[];
  selectedTagIds: ReadonlySet<string>;
  selectedSetlistIds: ReadonlySet<string>;
  setlistsLoading: boolean;
  onTagCheckedChange: (tagId: string, checked: boolean) => void;
  onSetlistCheckedChange: (setlistId: string, checked: boolean) => void;
  onClearFilters: () => void;
}

export function BeatOverviewFilterToolbar({
  tagOptions,
  setlistOptions,
  selectedTagIds,
  selectedSetlistIds,
  setlistsLoading,
  onTagCheckedChange,
  onSetlistCheckedChange,
  onClearFilters,
}: BeatOverviewFilterToolbarProps) {
  const filterCount = selectedTagIds.size + selectedSetlistIds.size;

  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-end gap-1"
      data-testid="beat-overview-filter-toolbar"
    >
      <FilterDropdown
        icon={<Tag className="size-3" />}
        label="Tags"
        count={selectedTagIds.size}
        disabled={tagOptions.length === 0}
      >
        <DropdownMenuLabel className="text-xs">
          Tags
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tagOptions.length === 0 ? (
          <EmptyFilterItem label="No tags" />
        ) : tagOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selectedTagIds.has(option.id)}
            className="max-w-64 text-xs"
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onTagCheckedChange(option.id, checked === true)
            }
          >
            <span className="min-w-0 flex-1 truncate">
              {option.label}
            </span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {option.count}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </FilterDropdown>

      <FilterDropdown
        icon={<ListMusic className="size-3" />}
        label="Setlists"
        count={selectedSetlistIds.size}
        disabled={!setlistsLoading && setlistOptions.length === 0}
      >
        <DropdownMenuLabel className="text-xs">
          Setlists
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {setlistOptions.length === 0 ? (
          <EmptyFilterItem
            label={setlistsLoading ? "Loading..." : "No setlists"}
          />
        ) : setlistOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selectedSetlistIds.has(option.id)}
            className="max-w-80 text-xs"
            title={option.title}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onSetlistCheckedChange(option.id, checked === true)
            }
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {option.label}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </FilterDropdown>

      {filterCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 gap-1 px-1.5"
          data-testid="beat-overview-clear-filters"
          onClick={onClearFilters}
        >
          <X className="size-3" />
          Clear
        </Button>
      )}
    </div>
  );
}

function FilterDropdown({
  icon,
  label,
  count,
  disabled,
  children,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  disabled: boolean;
  children: ReactNode;
}) {
  const buttonLabel = count > 0 ? `${label} ${count}` : label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={count > 0 ? "secondary" : "outline"}
          size="xs"
          disabled={disabled}
          className="h-6 gap-1 px-1.5"
          data-testid={`beat-overview-filter-${label.toLowerCase()}`}
        >
          {icon}
          <span>{buttonLabel}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyFilterItem({ label }: { label: string }) {
  return (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">
      {label}
    </div>
  );
}
