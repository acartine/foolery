"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Beat, BeatPriority } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { BeatTypeBadge } from "@/components/beat-type-badge";
import { BeatStateBadge } from "@/components/beat-state-badge";
import { BeatPriorityBadge } from "@/components/beat-priority-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronRight, ChevronDown, X, Clapperboard, Square, Undo2 } from "lucide-react";
import { displayBeatLabel, stripBeatPrefix } from "@/lib/beat-display";
import { isWaveLabel, isInternalLabel, isReadOnlyLabel, extractWaveSlug } from "@/lib/wave-slugs";
import { builtinProfileDescriptor, builtinWorkflowDescriptors, isRollbackTransition } from "@/lib/workflows";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

const PRIORITIES: BeatPriority[] = [0, 1, 2, 3, 4];
type UpdateBeatFn = (id: string, fields: UpdateBeatInput, repoPath?: string) => void;

function formatLabel(val: string): string {
  return val.split(/[_-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const LABEL_COLORS = [
  "bg-red-100 text-red-800",
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-yellow-100 text-yellow-800",
  "bg-purple-100 text-purple-800",
  "bg-pink-100 text-pink-800",
  "bg-indigo-100 text-indigo-800",
  "bg-orange-100 text-orange-800",
  "bg-teal-100 text-teal-800",
  "bg-cyan-100 text-cyan-800",
];

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

/** @internal Exported for testing only. */
export function validNextStates(
  currentState: string | undefined,
  workflow: MemoryWorkflowDescriptor,
  rawKnoState?: string,
): string[] {
  if (!currentState) return [];
  const normalizeForTransitions = (state: string | undefined): string | undefined => {
    const normalizedState = state?.trim().toLowerCase();
    if (!normalizedState) return undefined;
    if (normalizedState === "impl" && (workflow.states ?? []).includes("implementation")) {
      return "implementation";
    }
    return normalizedState;
  };

  const normalized = normalizeForTransitions(currentState);
  if (!normalized) return [];
  const isQueuedDisplayState = normalized.startsWith("ready_for_");
  const normalizedRawKnoState = normalizeForTransitions(rawKnoState);

  // If the raw kno state differs from the display state, the knot is stuck in an
  // active phase that was rolled back for display. Compute transitions from the
  // actual kno state and include all workflow states as escape hatches.
  const isRolledBack = Boolean(
    normalizedRawKnoState && normalizedRawKnoState !== normalized,
  );
  const effectiveState = isRolledBack && normalizedRawKnoState
    ? normalizedRawKnoState
    : normalized;

  const next = new Set<string>();
  for (const t of workflow.transitions ?? []) {
    if (t.from === effectiveState || t.from === "*") {
      next.add(t.to);
    }
  }

  // Allow rollback from active/review states to any earlier queue state.
  const statesList = workflow.states ?? [];
  const effectiveIndex = statesList.indexOf(effectiveState);
  if (effectiveIndex > 0) {
    for (let i = 0; i < effectiveIndex; i++) {
      const earlier = statesList[i];
      if (earlier && earlier.startsWith("ready_for_")) {
        next.add(earlier);
      }
    }
  }

  // When stuck (rolled back), also add all non-terminal workflow states as force targets.
  if (isRolledBack) {
    for (const state of workflow.states ?? []) {
      if (!workflow.terminalStates?.includes(state)) {
        next.add(state);
      }
    }
  }

  // Remove current display state and raw state from options.
  next.delete(normalized);
  if (normalizedRawKnoState) next.delete(normalizedRawKnoState);

  // Keep queue-to-queue transitions hidden for queued rows, but allow queue
  // targets from active rows so users can advance/rollback action states.
  if (isRolledBack || !isQueuedDisplayState) {
    return Array.from(next);
  }
  return Array.from(next).filter((s) => !s.startsWith("ready_for_"));
}

function formatStateName(state: string): string {
  return state.replace(/_/g, " ");
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export interface AgentInfo {
  agentName?: string;
  model?: string;
  version?: string;
}

export interface BeatColumnOpts {
  showRepoColumn?: boolean;
  showAgentColumns?: boolean;
  agentInfoByBeatId?: Record<string, AgentInfo>;
  onUpdateBeat?: UpdateBeatFn;
  onTitleClick?: (beat: Beat) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId?: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
  allLabels?: string[];
  onCloseBeat?: (beatId: string) => void;
  collapsedIds?: Set<string>;
  onToggleCollapse?: (id: string) => void;
  childCountMap?: Map<string, number>;
  /** Available workflow states for the state dropdown. */
  availableStates?: string[];
  /** Beat IDs whose parent/ancestor is currently rolling (inherited rolling state). */
  parentRollingBeatIds?: Set<string>;
}

function repoPathForBeat(beat: Beat): string | undefined {
  const record = beat as Beat & { _repoPath?: unknown };
  const repoPath = record._repoPath;
  return typeof repoPath === "string" && repoPath.trim().length > 0 ? repoPath : undefined;
}

function AddLabelDropdown({
  beatId,
  existingLabels,
  onUpdateBeat,
  repoPath,
  allLabels = [],
}: {
  beatId: string;
  existingLabels: string[];
  onUpdateBeat: UpdateBeatFn;
  repoPath?: string;
  allLabels?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const availableLabels = allLabels.filter((l) => !existingLabels.includes(l));

  const addLabel = (label: string) => {
    onUpdateBeat(beatId, { labels: [label] }, repoPath);
    setOpen(false);
    setNewLabel("");
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-add-label
          title="Add a label"
          className="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold leading-none bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
          onClick={(e) => e.stopPropagation()}
        >
          + Label
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <div className="p-1">
          <input
            type="text"
            placeholder="New label..."
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLabel.trim()) {
                e.preventDefault();
                addLabel(newLabel.trim());
              }
              e.stopPropagation();
            }}
            className="w-full px-2 py-1 text-xs border rounded mb-1 outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>
        {availableLabels.map((label) => (
          <DropdownMenuItem key={label} onClick={() => addLabel(label)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TitleCell({ beat, onTitleClick, onUpdateBeat, allLabels }: {
  beat: Beat;
  onTitleClick?: (beat: Beat) => void;
  onUpdateBeat?: UpdateBeatFn;
  allLabels?: string[];
}) {
  const labels = beat.labels ?? [];
  const isOrchestrated = labels.some(isWaveLabel);
  const waveSlug = extractWaveSlug(labels);
  const visibleLabels = labels.filter((l) => !isInternalLabel(l));
  return (
    <div className="min-w-0 flex flex-1 flex-col gap-0.5">
      {onTitleClick ? (
        <button
          type="button"
          title="Open beat details"
          className="text-left font-medium break-words hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onTitleClick(beat);
          }}
        >
          {waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}{beat.title}
        </button>
      ) : (
        <span className="font-medium break-words">{waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}{beat.title}</span>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-muted-foreground text-xs">
          {relativeTime(beat.updated)}
        </span>
        {beat.requiresHumanAction && (
          <span className="inline-flex items-center rounded px-1 py-0 text-[10px] font-semibold leading-none bg-rose-100 text-rose-700">
            Human action
          </span>
        )}
        {isOrchestrated && (
          <span className="inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium leading-none bg-slate-100 text-slate-600">
            <Clapperboard className="size-2.5" />
            Orchestrated
          </span>
        )}
        {visibleLabels.map((label) => (
          <span
            key={label}
            className={`inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium leading-none ${labelColor(label)}`}
          >
            {label}
            {onUpdateBeat && !isReadOnlyLabel(label) && (
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-black/10 p-0.5 leading-none"
                title={`Remove ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateBeat(beat.id, { removeLabels: [label] }, repoPathForBeat(beat));
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {onUpdateBeat && (
          <AddLabelDropdown
            beatId={beat.id}
            existingLabels={labels}
            onUpdateBeat={onUpdateBeat}
            repoPath={repoPathForBeat(beat)}
            allLabels={allLabels}
          />
        )}
      </div>
    </div>
  );
}

export function getBeatColumns(opts: BeatColumnOpts | boolean = false): ColumnDef<Beat>[] {
  const showRepoColumn = typeof opts === "boolean" ? opts : (opts.showRepoColumn ?? false);
  const showAgentColumns = typeof opts === "boolean" ? false : (opts.showAgentColumns ?? false);
  const agentInfoByBeatId = typeof opts === "boolean" ? {} : (opts.agentInfoByBeatId ?? {});
  const onUpdateBeat = typeof opts === "boolean" ? undefined : opts.onUpdateBeat;
  const onTitleClick = typeof opts === "boolean" ? undefined : opts.onTitleClick;
  const onShipBeat = typeof opts === "boolean" ? undefined : opts.onShipBeat;
  const shippingByBeatId = typeof opts === "boolean" ? {} : (opts.shippingByBeatId ?? {});
  const onAbortShipping = typeof opts === "boolean" ? undefined : opts.onAbortShipping;
  const allLabels = typeof opts === "boolean" ? undefined : opts.allLabels;
  const profiles = builtinWorkflowDescriptors();
  const onCloseBeat = typeof opts === "boolean" ? undefined : opts.onCloseBeat;
  const collapsedIds = typeof opts === "boolean" ? new Set<string>() : (opts.collapsedIds ?? new Set<string>());
  const onToggleCollapse = typeof opts === "boolean" ? undefined : opts.onToggleCollapse;
  const childCountMap = typeof opts === "boolean" ? new Map<string, number>() : (opts.childCountMap ?? new Map<string, number>());
  const parentRollingBeatIds = typeof opts === "boolean" ? new Set<string>() : (opts.parentRollingBeatIds ?? new Set<string>());

  const columns: ColumnDef<Beat>[] = [
    {
      id: "select",
      size: 30,
      minSize: 30,
      maxSize: 30,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
    },
    {
      accessorKey: "id",
      header: "",
      size: 120,
      minSize: 90,
      maxSize: 160,
      enableSorting: false,
      cell: ({ row }) => {
        const shortId = stripBeatPrefix(row.original.id);
        const displayId = displayBeatLabel(row.original.id, row.original.aliases);
        return (
          <button
            type="button"
            className="flex max-w-full cursor-pointer flex-col items-start text-left hover:text-foreground"
            title="Click to copy ID"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(shortId).then(
                () => toast.success(`Copied: ${shortId}`),
                () => toast.error("Failed to copy to clipboard"),
              );
            }}
          >
            <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
              {displayId}
            </span>
            {displayId !== shortId && (
              <span className="max-w-full truncate text-[10px] text-muted-foreground/80">
                {shortId}
              </span>
            )}
          </button>
        );
      },
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => {
        const hb = row.original as unknown as { _depth?: number; _hasChildren?: boolean };
        const depth = hb._depth ?? 0;
        const hasChildren = hb._hasChildren ?? false;
        const isCollapsed = collapsedIds.has(row.original.id);
        const Chevron = isCollapsed ? ChevronRight : ChevronDown;
        return (
          <div className="flex items-start gap-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
            {hasChildren ? (
              <div className="relative shrink-0 flex items-start w-3.5">
                {isCollapsed && childCountMap.get(row.original.id) != null && (
                  <span className="absolute right-full mr-0.5 text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 leading-none py-0.5 mt-0.5 whitespace-nowrap">
                    {childCountMap.get(row.original.id)}
                  </span>
                )}
                <button
                  type="button"
                  title={isCollapsed ? "Expand children" : "Collapse children"}
                  className="p-0 mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse?.(row.original.id);
                  }}
                >
                  <Chevron className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className="inline-block w-3.5 shrink-0" />
            )}
            <TitleCell
              beat={row.original}
              onTitleClick={onTitleClick}
              onUpdateBeat={onUpdateBeat}
              allLabels={allLabels}
            />
          </div>
        );
      },
    },
    {
      accessorKey: "priority",
      header: "Priority",
      size: 70,
      minSize: 70,
      maxSize: 70,
      cell: ({ row }) => {
        if (!onUpdateBeat) return <BeatPriorityBadge priority={row.original.priority} />;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title="Change priority" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                <BeatPriorityBadge priority={row.original.priority} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={String(row.original.priority)}
                onValueChange={(v) => onUpdateBeat(
                  row.original.id,
                  { priority: Number(v) as BeatPriority },
                  repoPathForBeat(row.original),
                )}
              >
                {PRIORITIES.map((p) => (
                  <DropdownMenuRadioItem key={p} value={String(p)}>P{p}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      size: 80,
      minSize: 80,
      maxSize: 80,
      cell: ({ row }) => {
        return (
          <div className="flex items-center">
            <BeatTypeBadge type={row.original.type} />
          </div>
        );
      },
    },
    {
      accessorKey: "profileId",
      header: "Profile",
      size: 130,
      minSize: 130,
      maxSize: 130,
      cell: ({ row }) => {
        const profileId = row.original.profileId;
        const badge = profileId ? (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none bg-emerald-100 text-emerald-700">
            {formatLabel(profileId)}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">&mdash;</span>
        );

        if (!onUpdateBeat) return badge;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title="Change profile" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                {badge}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={profileId ?? ""}
                onValueChange={(v) => onUpdateBeat(
                  row.original.id,
                  { profileId: v },
                  repoPathForBeat(row.original),
                )}
              >
                {profiles.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id}>
                    {formatLabel(p.id)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  // Owner Type column: shows "Agent" or "Human" based on nextActionOwnerKind
  columns.push({
    id: "ownerType",
    header: "Owner Type",
    size: 90,
    minSize: 90,
    maxSize: 90,
    enableSorting: false,
    cell: ({ row }) => {
      const beat = row.original;
      const isTerminal = beat.state === "shipped" || beat.state === "abandoned" || beat.state === "closed";
      if (isTerminal || beat.type === "gate") return null;
      const kind = beat.nextActionOwnerKind;
      if (!kind || kind === "none") return null;
      if (kind === "human") {
        return (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-amber-100 text-amber-700">
            Human
          </span>
        );
      }
      return (
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-blue-100 text-blue-700">
          Agent
        </span>
      );
    },
  });

  // State column: content can grow and consume width from the title column.
  columns.push({
    accessorKey: "state",
    header: "State",
    meta: { minWidthPx: 128 },
    cell: ({ row }) => {
      const isRolling = Boolean(shippingByBeatId[row.original.id]);
      const isParentRolling = parentRollingBeatIds.has(row.original.id);
      const isInheritedRolling = isRolling || isParentRolling;
      const state = row.original.state;
      const isTerminal = state === "shipped" || state === "abandoned" || state === "closed";
      const pulseClass = isInheritedRolling && !isTerminal ? "animate-pulse" : "";
      return (
        <div className="flex items-center gap-0.5">
          {onUpdateBeat && !isInheritedRolling ? (() => {
            const workflow = builtinProfileDescriptor(row.original.profileId);
            const rawKnoState = typeof row.original.metadata?.knotsState === "string"
              ? row.original.metadata.knotsState
              : undefined;
            const nextStates = validNextStates(state, workflow, rawKnoState);
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" title="Change state" className={`cursor-pointer ${pulseClass}`} onClick={(e) => e.stopPropagation()}>
                    <BeatStateBadge state={state} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuRadioGroup
                    value={state}
                    onValueChange={(v) => onUpdateBeat(
                      row.original.id,
                      { state: v },
                      repoPathForBeat(row.original),
                    )}
                  >
                    <DropdownMenuRadioItem value={state}>
                      {formatStateName(state)} (current)
                    </DropdownMenuRadioItem>
                    {nextStates.filter((s) => !isRollbackTransition(state, s)).map((s) => (
                      <DropdownMenuRadioItem key={s} value={s}>
                        {formatStateName(s)}
                      </DropdownMenuRadioItem>
                    ))}
                    {nextStates.some((s) => isRollbackTransition(state, s)) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Undo2 className="size-3" />
                          Rollback
                        </DropdownMenuLabel>
                      </>
                    )}
                    {nextStates.filter((s) => isRollbackTransition(state, s)).map((s) => (
                      <DropdownMenuRadioItem key={s} value={s}>
                        {formatStateName(s)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })() : (
            <BeatStateBadge state={state} className={pulseClass} />
          )}
        </div>
      );
    },
  });

  // Agent info columns: show agent name, model, and version in the active view.
  if (showAgentColumns) {
    const agentCell = (beatId: string, field: keyof AgentInfo) => {
      const info = agentInfoByBeatId[beatId];
      const value = info?.[field];
      if (!value) return <span className="text-muted-foreground text-xs">&mdash;</span>;
      return <span className="text-xs font-mono truncate" title={value}>{value}</span>;
    };

    columns.push(
      {
        id: "agentName",
        header: "Agent",
        size: 90,
        minSize: 70,
        maxSize: 120,
        enableSorting: false,
        cell: ({ row }) => agentCell(row.original.id, "agentName"),
      },
      {
        id: "agentModel",
        header: "Model",
        size: 160,
        minSize: 120,
        maxSize: 220,
        enableSorting: false,
        cell: ({ row }) => agentCell(row.original.id, "model"),
      },
      {
        id: "agentVersion",
        header: "Version",
        size: 90,
        minSize: 80,
        maxSize: 120,
        enableSorting: false,
        cell: ({ row }) => agentCell(row.original.id, "version"),
      },
    );
  }

  // Action column: shows Take!/Scene!/Rolling... buttons as the last column
  if (onShipBeat) {
    columns.push({
      id: "action",
      header: "Action",
      size: 100,
      minSize: 100,
      maxSize: 100,
      enableSorting: false,
      cell: ({ row }) => {
        const beat = row.original;
        const isTerminal = beat.state === "shipped" || beat.state === "abandoned" || beat.state === "closed";
        if (isTerminal || beat.type === "gate") return null;
        if (beat.nextActionOwnerKind === "human") return null;
        const isActiveShipping = Boolean(shippingByBeatId[beat.id]);
        const isChildOfRolling = parentRollingBeatIds.has(beat.id);
        const hb = beat as unknown as { _hasChildren?: boolean };
        const isParent = hb._hasChildren ?? false;
        const actionLabel = isParent ? "Scene!" : "Take!";

        if (isActiveShipping) {
          return (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-xs font-semibold text-green-700">
                Rolling...
              </span>
              <button
                type="button"
                title="Terminating"
                className="inline-flex h-5 w-5 items-center justify-center rounded bg-red-600 text-white hover:bg-red-500"
                onClick={(e) => {
                  e.stopPropagation();
                  onAbortShipping?.(beat.id);
                }}
              >
                <Square className="size-3" />
              </button>
            </div>
          );
        }

        if (isChildOfRolling) {
          return (
            <span className="text-xs font-semibold text-green-700 animate-pulse">
              Rolling...
            </span>
          );
        }

        return (
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${isParent ? "text-purple-700 hover:bg-purple-100" : "text-blue-700 hover:bg-blue-100"}`}
            title={actionLabel}
            onClick={(e) => {
              e.stopPropagation();
              onShipBeat(beat);
            }}
          >
            <Clapperboard className="size-3" />
            {actionLabel}
          </button>
        );
      },
    });
  }

  if (showRepoColumn) {
    columns.splice(1, 0, {
      id: "_repoName",
      header: "Repo",
      size: 100,
      minSize: 100,
      maxSize: 100,
      cell: ({ row }) => {
        const repoName = (row.original as unknown as Record<string, unknown>)._repoName;
        return repoName ? (
          <span className="text-xs font-mono text-muted-foreground">
            {repoName as string}
          </span>
        ) : (
          "-"
        );
      },
    });
  }

  return columns;
}

export const beatColumns = getBeatColumns({ showRepoColumn: false });
