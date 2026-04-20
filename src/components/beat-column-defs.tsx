"use client";

import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Beat } from "@/lib/types";
import {
  BeatTypeBadge,
} from "@/components/beat-type-badge";
import {
  BeatPriorityBadge,
} from "@/components/beat-priority-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  displayBeatLabel,
  stripBeatPrefix,
} from "@/lib/beat-display";
import {
  builtinWorkflowDescriptors,
} from "@/lib/workflows";
import type {
  AgentInfo,
  BeatColumnOpts,
} from "./beat-column-types";
import {
  PRIORITIES,
  formatLabel,
  repoPathForBeat,
  TitleCell,
} from "./beat-column-helpers";
import type {
  UpdateBeatFn,
} from "./beat-column-helpers";

/** Resolved options for column builders. */
export interface ResolvedOpts {
  onUpdateBeat?: UpdateBeatFn;
  onTitleClick?: (beat: Beat) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
  allLabels?: string[];
  collapsedIds: Set<string>;
  onToggleCollapse?: (id: string) => void;
  childCountMap: Map<string, number>;
  parentRollingBeatIds: Set<string>;
  agentInfoByBeatId: Record<string, AgentInfo>;
}

export function resolveOpts(
  opts: BeatColumnOpts | boolean,
): ResolvedOpts {
  if (typeof opts === "boolean") {
    return {
      shippingByBeatId: {},
      collapsedIds: new Set<string>(),
      childCountMap: new Map<string, number>(),
      parentRollingBeatIds: new Set<string>(),
      agentInfoByBeatId: {},
    };
  }
  return {
    onUpdateBeat: opts.onUpdateBeat,
    onTitleClick: opts.onTitleClick,
    onShipBeat: opts.onShipBeat,
    shippingByBeatId: opts.shippingByBeatId ?? {},
    onAbortShipping: opts.onAbortShipping,
    allLabels: opts.allLabels,
    collapsedIds: opts.collapsedIds ?? new Set<string>(),
    onToggleCollapse: opts.onToggleCollapse,
    childCountMap:
      opts.childCountMap ?? new Map<string, number>(),
    parentRollingBeatIds:
      opts.parentRollingBeatIds ?? new Set<string>(),
    agentInfoByBeatId: opts.agentInfoByBeatId ?? {},
  };
}

export function selectColumn(): ColumnDef<Beat> {
  return {
    id: "select",
    size: 30,
    minSize: 30,
    maxSize: 30,
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(value) =>
          table.toggleAllPageRowsSelected(!!value)
        }
        aria-label="Select all"
        onClick={(e) => e.stopPropagation()}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) =>
          row.toggleSelected(!!value)
        }
        aria-label="Select row"
        onClick={(e) => e.stopPropagation()}
      />
    ),
    enableSorting: false,
  };
}

export function idColumn(): ColumnDef<Beat> {
  return {
    accessorKey: "id",
    header: "",
    size: 120,
    minSize: 90,
    maxSize: 160,
    enableSorting: false,
    cell: ({ row }) => {
      const shortId = stripBeatPrefix(
        row.original.id,
      );
      const displayId = displayBeatLabel(row.original.id, row.original.aliases);
      return (
        <button
          type="button"
          className={
            "flex max-w-full cursor-pointer"
            + " flex-col items-start text-left"
            + " hover:text-foreground"
          }
          title="Click to copy ID"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard
              .writeText(displayId)
              .then(
                () =>
                  toast.success(
                    `Copied: ${displayId}`,
                  ),
                () =>
                  toast.error(
                    "Failed to copy to clipboard",
                  ),
              );
          }}
        >
          <span
            className={
              "max-w-full truncate font-mono"
              + " text-xs text-muted-foreground"
            }
          >
            {displayId}
          </span>
          {displayId !== shortId && (
            <span
              className={
                "max-w-full truncate text-[10px]"
                + " text-muted-foreground/80"
              }
            >
              {shortId}
            </span>
          )}
        </button>
      );
    },
  };
}

export function titleColumn(
  r: ResolvedOpts,
): ColumnDef<Beat> {
  return {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => {
      const hb = row.original as unknown as {
        _depth?: number;
        _hasChildren?: boolean;
      };
      const depth = hb._depth ?? 0;
      const hasChildren = hb._hasChildren ?? false;
      const isCollapsed = r.collapsedIds.has(
        row.original.id,
      );
      const Chevron = isCollapsed
        ? ChevronRight
        : ChevronDown;
      return (
        <div
          className="flex items-center gap-0.5"
          style={{
            paddingLeft: `${depth * 16}px`,
          }}
        >
          {hasChildren ? (
            <div
              className={
                "relative shrink-0"
                + " flex items-center w-3.5"
              }
            >
              {isCollapsed
                && r.childCountMap.get(
                  row.original.id,
                ) != null && (
                <span
                  className={
                    "absolute right-full mr-0.5"
                    + " text-[10px] font-medium"
                    + " text-muted-foreground"
                    + " bg-muted rounded-full"
                    + " px-1.5 leading-none"
                    + " py-0.5 mt-0.5 whitespace-nowrap"
                  }
                >
                  {r.childCountMap.get(
                    row.original.id,
                  )}
                </span>
              )}
              <button
                type="button"
                title={
                  isCollapsed
                    ? "Expand children"
                    : "Collapse children"
                }
                className={
                  "p-0"
                  + " text-muted-foreground"
                  + " hover:text-foreground shrink-0"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  r.onToggleCollapse?.(
                    row.original.id,
                  );
                }}
              >
                <Chevron className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <span
              className={
                "inline-block w-3.5 shrink-0"
              }
            />
          )}
          <TitleCell
            beat={row.original}
            onTitleClick={r.onTitleClick}
            onUpdateBeat={r.onUpdateBeat}
            allLabels={r.allLabels}
          />
        </div>
      );
    },
  };
}

export function priorityColumn(
  r: ResolvedOpts,
): ColumnDef<Beat> {
  return {
    accessorKey: "priority",
    header: "Priority",
    size: 70,
    minSize: 70,
    maxSize: 70,
    cell: ({ row }) => {
      if (!r.onUpdateBeat) {
        return (
          <BeatPriorityBadge
            priority={row.original.priority}
          />
        );
      }
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Change priority"
              className="cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              <BeatPriorityBadge
                priority={row.original.priority}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={String(
                row.original.priority,
              )}
              onValueChange={(v) =>
                r.onUpdateBeat!(
                  row.original.id,
                  {
                    priority: Number(v) as Beat[
                      "priority"
                    ],
                  },
                  repoPathForBeat(row.original),
                )
              }
            >
              {PRIORITIES.map((p) => (
                <DropdownMenuRadioItem
                  key={p}
                  value={String(p)}
                >
                  P{p}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  };
}

export function profileColumn(
  r: ResolvedOpts,
): ColumnDef<Beat> {
  const profiles = builtinWorkflowDescriptors();
  return {
    accessorKey: "profileId",
    header: "Profile",
    size: 130,
    minSize: 130,
    maxSize: 130,
    cell: ({ row }) => {
      const profileId = row.original.profileId;
      const badge = profileId ? (
        <span
          className={
            "inline-flex h-5 items-center rounded"
            + " px-1.5 text-[10px]"
            + " font-medium"
            + " bg-emerald-100 text-emerald-700"
          }
        >
          {formatLabel(profileId)}
        </span>
      ) : (
        <span
          className={
            "text-muted-foreground text-xs"
          }
        >
          &mdash;
        </span>
      );
      if (!r.onUpdateBeat) return badge;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Change profile"
              className="cursor-pointer"
              onClick={(e) =>
                e.stopPropagation()
              }
            >
              {badge}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={profileId ?? ""}
              onValueChange={(v) =>
                r.onUpdateBeat!(
                  row.original.id,
                  { profileId: v },
                  repoPathForBeat(row.original),
                )
              }
            >
              {profiles.map((p) => (
                <DropdownMenuRadioItem
                  key={p.id}
                  value={p.id}
                >
                  {formatLabel(p.id)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  };
}

export function typeColumn(): ColumnDef<Beat> {
  return {
    id: "type",
    accessorKey: "type",
    header: "Type",
    size: 80,
    minSize: 80,
    maxSize: 80,
    cell: ({ row }) => (
      <div className="flex items-center">
        <BeatTypeBadge type={row.original.type} />
      </div>
    ),
  };
}

export function ownerTypeColumn(): ColumnDef<Beat> {
  return {
    id: "ownerType",
    header: "Owner Type",
    size: 90,
    minSize: 90,
    maxSize: 90,
    enableSorting: false,
    cell: ({ row }) => {
      const beat = row.original;
      const isTerminal =
        beat.state === "shipped"
        || beat.state === "abandoned"
        || beat.state === "closed";
      if (isTerminal) {
        return null;
      }
      const kind = beat.nextActionOwnerKind;
      if (!kind || kind === "none") return null;
      if (kind === "human") {
        return (
          <span
            className={
              "inline-flex h-5 items-center rounded"
              + " px-1.5 text-[10px]"
              + " font-semibold"
              + " bg-amber-100 text-amber-700"
            }
          >
            Human
          </span>
        );
      }
      return (
        <span
          className={
            "inline-flex h-5 items-center rounded"
            + " px-1.5 text-[10px]"
            + " font-semibold"
            + " bg-blue-100 text-blue-700"
          }
        >
          Agent
        </span>
      );
    },
  };
}
