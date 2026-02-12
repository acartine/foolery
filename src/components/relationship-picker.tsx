"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBeads } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Search } from "lucide-react";
import type { Bead } from "@/lib/types";

interface RelationshipPickerProps {
  label: string;
  selectedIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  excludeId?: string;
  repo?: string;
}

export function RelationshipPicker({
  label,
  selectedIds,
  onAdd,
  onRemove,
  excludeId,
  repo,
}: RelationshipPickerProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data } = useQuery({
    queryKey: ["beads-search", query, repo],
    queryFn: () =>
      fetchBeads(query ? { q: query } : undefined, repo || undefined),
    enabled: searchOpen && query.length > 0,
  });

  const results = useMemo<Bead[]>(() => {
    if (!data?.ok || !data.data) return [];
    return data.data.filter(
      (b) => b.id !== excludeId && !selectedIds.includes(b.id),
    );
  }, [data, excludeId, selectedIds]);

  return (
    <div className="space-y-1.5">
      <PickerHeader
        label={label}
        onToggle={() => setSearchOpen(!searchOpen)}
      />
      <SelectedBadges selectedIds={selectedIds} onRemove={onRemove} />
      {searchOpen && (
        <SearchDropdown
          query={query}
          onQueryChange={setQuery}
          results={results}
          onSelect={(id) => {
            onAdd(id);
            setQuery("");
            setSearchOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PickerHeader({
  label,
  onToggle,
}: {
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={onToggle}
      >
        <Plus className="size-3 mr-1" />
        Add
      </Button>
    </div>
  );
}

function SelectedBadges({
  selectedIds,
  onRemove,
}: {
  selectedIds: string[];
  onRemove: (id: string) => void;
}) {
  if (selectedIds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {selectedIds.map((id) => (
        <Badge
          key={id}
          variant="outline"
          className="gap-1 pr-1 font-mono text-xs"
        >
          {id.replace(/^[^-]+-/, "")}
          <button
            type="button"
            className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
            onClick={() => onRemove(id)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

function SearchDropdown({
  query,
  onQueryChange,
  results,
  onSelect,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: Bead[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="border rounded-md p-2 space-y-1">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
        <Input
          autoFocus
          type="text"
          placeholder="Search by ID or title..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-7 pl-7 text-xs"
        />
      </div>
      {results.length > 0 && (
        <ul className="max-h-32 overflow-y-auto space-y-0.5">
          {results.slice(0, 10).map((bead) => (
            <li key={bead.id}>
              <button
                type="button"
                className="w-full text-left px-2 py-1 text-xs rounded hover:bg-muted flex items-center gap-2"
                onClick={() => onSelect(bead.id)}
              >
                <span className="font-mono text-muted-foreground">
                  {bead.id.replace(/^[^-]+-/, "")}
                </span>
                <span className="truncate">{bead.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && results.length === 0 && (
        <p className="text-xs text-muted-foreground px-2 py-1">No results</p>
      )}
    </div>
  );
}
