"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/app-store";
import { X } from "lucide-react";
import type { BeadStatus, BeadType } from "@/lib/types";

const statuses: BeadStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
];
const types: BeadType[] = [
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
  "merge-request",
  "molecule",
  "gate",
];

function formatLabel(val: string): string {
  return val
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function FilterBar() {
  const { filters, setFilter, resetFilters } = useAppStore();

  const hasFilters =
    filters.status || filters.type || filters.priority !== undefined || filters.assignee;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={filters.status ?? "all"}
        onValueChange={(v) => setFilter("status", v === "all" ? undefined : (v as BeadStatus))}
      >
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {formatLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.type ?? "all"}
        onValueChange={(v) => setFilter("type", v === "all" ? undefined : (v as BeadType))}
      >
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          {types.map((t) => (
            <SelectItem key={t} value={t}>
              {formatLabel(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.priority !== undefined ? String(filters.priority) : "all"}
        onValueChange={(v) =>
          setFilter("priority", v === "all" ? undefined : (Number(v) as 0 | 1 | 2 | 3 | 4))
        }
      >
        <SelectTrigger className="w-[140px] h-9">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priorities</SelectItem>
          {[0, 1, 2, 3, 4].map((p) => (
            <SelectItem key={p} value={String(p)}>
              P{p} - {["Critical", "High", "Medium", "Low", "Trivial"][p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        placeholder="Assignee..."
        value={filters.assignee ?? ""}
        onChange={(e) => setFilter("assignee", e.target.value || undefined)}
        className="w-[160px] h-9"
      />

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
