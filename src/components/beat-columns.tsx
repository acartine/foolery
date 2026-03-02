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
import { Check, ThumbsDown, ChevronRight, ChevronDown, X, Clapperboard, Square, Eye, ShieldCheck, Undo2 } from "lucide-react";
import { isWaveLabel, isInternalLabel, isReadOnlyLabel, extractWaveSlug, isTransitionLocked } from "@/lib/wave-slugs";
import { builtinProfileDescriptor, builtinWorkflowDescriptors, isRollbackTransition } from "@/lib/workflows";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

const PRIORITIES: BeatPriority[] = [0, 1, 2, 3, 4];

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

function validNextStates(
  currentState: string | undefined,
  workflow: MemoryWorkflowDescriptor,
): string[] {
  if (!currentState) return [];
  const normalized = currentState.trim().toLowerCase();
  const next = new Set<string>();
  for (const t of workflow.transitions ?? []) {
    if (t.from === normalized || t.from === "*") {
      next.add(t.to);
    }
  }
  next.delete(normalized);
  return Array.from(next);
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

export interface BeatColumnOpts {
  showRepoColumn?: boolean;
  onUpdateBeat?: (id: string, fields: UpdateBeatInput) => void;
  onTitleClick?: (beat: Beat) => void;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId?: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
  allLabels?: string[];
  builtForReviewIds?: Set<string>;
  onApproveReview?: (parentId: string) => void;
  onRejectReview?: (parentId: string) => void;
  onRejectBeat?: (beat: Beat) => void;
  onCloseBeat?: (beatId: string) => void;
  collapsedIds?: Set<string>;
  onToggleCollapse?: (id: string) => void;
  childCountMap?: Map<string, number>;
  /** Available workflow states for the state dropdown. */
  availableStates?: string[];
}

function isVerificationState(beat: Beat): boolean {
  return beat.state === "ready_for_implementation_review" || beat.state === "verification";
}

function VerificationButtons({
  beat,
  onUpdateBeat,
  isRolling,
}: {
  beat: Beat;
  onUpdateBeat?: (id: string, fields: UpdateBeatInput) => void;
  isRolling?: boolean;
}) {
  const hasVerification = isVerificationState(beat);
  const hasTransition = isTransitionLocked(beat.labels ?? []);

  if (hasTransition) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-amber-100 text-amber-700 animate-pulse"
        title="Auto-verification in progress"
      >
        <ShieldCheck className="size-3 animate-spin" style={{ animationDuration: "3s" }} />
        Verifying
      </span>
    );
  }

  if (!hasVerification || !onUpdateBeat || isRolling) return null;

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-1 text-green-700 hover:bg-green-100"
        title="Verify (LGTM)"
        onClick={(e) => {
          e.stopPropagation();
          onUpdateBeat(beat.id, verifyBeatFields());
        }}
      >
        <Check className="size-4" />
      </button>
    </>
  );
}

export function verifyBeatFields(): UpdateBeatInput {
  return {
    state: "shipped",
  };
}

export function rejectBeatFields(beat: Beat): UpdateBeatInput {
  const currentLabels = beat.labels ?? [];
  const prev = currentLabels.find((l) => l.startsWith("attempts:"));
  const attemptNum = prev ? parseInt(prev.split(":")[1], 10) + 1 : 1;
  const removeLabels = prev ? [prev] : undefined;
  return {
    state: "ready_for_implementation",
    removeLabels,
    labels: [`attempts:${attemptNum}`],
  };
}

function RejectButton({
  beat,
  onUpdateBeat,
  onRejectBeat,
  isRolling,
}: {
  beat: Beat;
  onUpdateBeat?: (id: string, fields: UpdateBeatInput) => void;
  onRejectBeat?: (beat: Beat) => void;
  isRolling?: boolean;
}) {
  const hasVerification = isVerificationState(beat);
  if (!hasVerification || (!onUpdateBeat && !onRejectBeat) || isRolling) return null;

  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded p-1 text-red-700 hover:bg-red-100"
      title="Reject"
      onClick={(e) => {
        e.stopPropagation();
        if (onRejectBeat) {
          onRejectBeat(beat);
        } else if (onUpdateBeat) {
          onUpdateBeat(beat.id, rejectBeatFields(beat));
        }
      }}
    >
      <ThumbsDown className="size-4" />
    </button>
  );
}

function AddLabelDropdown({
  beatId,
  existingLabels,
  onUpdateBeat,
  allLabels = [],
}: {
  beatId: string;
  existingLabels: string[];
  onUpdateBeat: (id: string, fields: UpdateBeatInput) => void;
  allLabels?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const availableLabels = allLabels.filter((l) => !existingLabels.includes(l));

  const addLabel = (label: string) => {
    onUpdateBeat(beatId, { labels: [label] });
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

function TitleCell({ beat, onTitleClick, onUpdateBeat, allLabels, isBuiltForReview, onApproveReview, onRejectReview }: {
  beat: Beat;
  onTitleClick?: (beat: Beat) => void;
  onUpdateBeat?: (id: string, fields: UpdateBeatInput) => void;
  allLabels?: string[];
  isBuiltForReview?: boolean;
  onApproveReview?: (parentId: string) => void;
  onRejectReview?: (parentId: string) => void;
}) {
  const labels = beat.labels ?? [];
  const isOrchestrated = labels.some(isWaveLabel);
  const isLocked = isTransitionLocked(labels);
  const waveSlug = extractWaveSlug(labels);
  const visibleLabels = labels.filter((l) => !isInternalLabel(l));
  const effectiveOnUpdateBeat = isLocked ? undefined : onUpdateBeat;
  return (
    <div className="flex flex-col gap-0.5">
      {onTitleClick ? (
        <button
          type="button"
          title="Open beat details"
          className="font-medium text-left hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onTitleClick(beat);
          }}
        >
          {waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}{beat.title}
        </button>
      ) : (
        <span className="font-medium">{waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}{beat.title}</span>
      )}
      {isBuiltForReview && (
        <div className="mt-0.5 flex items-center gap-1.5 rounded border border-orange-200 bg-orange-50 px-2 py-1">
          <Eye className="size-3.5 text-orange-600 shrink-0" />
          <span className="text-xs font-semibold text-orange-700">Built for Review</span>
          {onApproveReview && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded p-0.5 text-green-700 hover:bg-green-100"
              title="Approve all"
              onClick={(e) => {
                e.stopPropagation();
                onApproveReview(beat.id);
              }}
            >
              <Check className="size-4" />
            </button>
          )}
          {onRejectReview && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded p-0.5 text-red-700 hover:bg-red-100"
              title="Reject all"
              onClick={(e) => {
                e.stopPropagation();
                onRejectReview(beat.id);
              }}
            >
              <ThumbsDown className="size-4" />
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-muted-foreground text-xs">
          {relativeTime(beat.updated)}
        </span>
        {beat.profileId && (
          <span className="inline-flex items-center rounded px-1 py-0 text-[10px] font-medium leading-none bg-emerald-100 text-emerald-700">
            {beat.profileId}
          </span>
        )}
        {beat.nextActionOwnerKind && beat.nextActionOwnerKind !== "none" && (
          <span className={`inline-flex items-center rounded px-1 py-0 text-[10px] font-medium leading-none ${
            beat.nextActionOwnerKind === "human"
              ? "bg-amber-100 text-amber-700"
              : "bg-blue-100 text-blue-700"
          }`}>
            {beat.nextActionOwnerKind === "human" ? "Human next" : "Agent next"}
          </span>
        )}
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
            {effectiveOnUpdateBeat && !isReadOnlyLabel(label) && (
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-black/10 p-0.5 leading-none"
                title={`Remove ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  effectiveOnUpdateBeat(beat.id, { removeLabels: [label] });
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {effectiveOnUpdateBeat && (
          <AddLabelDropdown beatId={beat.id} existingLabels={labels} onUpdateBeat={effectiveOnUpdateBeat} allLabels={allLabels} />
        )}
      </div>
    </div>
  );
}

export function getBeatColumns(opts: BeatColumnOpts | boolean = false): ColumnDef<Beat>[] {
  const showRepoColumn = typeof opts === "boolean" ? opts : (opts.showRepoColumn ?? false);
  const onUpdateBeat = typeof opts === "boolean" ? undefined : opts.onUpdateBeat;
  const onTitleClick = typeof opts === "boolean" ? undefined : opts.onTitleClick;
  const onShipBeat = typeof opts === "boolean" ? undefined : opts.onShipBeat;
  const shippingByBeatId = typeof opts === "boolean" ? {} : (opts.shippingByBeatId ?? {});
  const onAbortShipping = typeof opts === "boolean" ? undefined : opts.onAbortShipping;
  const allLabels = typeof opts === "boolean" ? undefined : opts.allLabels;
  const profiles = builtinWorkflowDescriptors();
  const builtForReviewIds = typeof opts === "boolean" ? new Set<string>() : (opts.builtForReviewIds ?? new Set<string>());
  const onApproveReview = typeof opts === "boolean" ? undefined : opts.onApproveReview;
  const onRejectReview = typeof opts === "boolean" ? undefined : opts.onRejectReview;
  const onRejectBeat = typeof opts === "boolean" ? undefined : opts.onRejectBeat;
  const onCloseBeat = typeof opts === "boolean" ? undefined : opts.onCloseBeat;
  const collapsedIds = typeof opts === "boolean" ? new Set<string>() : (opts.collapsedIds ?? new Set<string>());
  const onToggleCollapse = typeof opts === "boolean" ? undefined : opts.onToggleCollapse;
  const childCountMap = typeof opts === "boolean" ? new Map<string, number>() : (opts.childCountMap ?? new Map<string, number>());

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
      size: 75,
      minSize: 75,
      maxSize: 75,
      enableSorting: false,
      cell: ({ row }) => {
        const shortId = row.original.id.replace(/^[^-]+-/, "");
        return (
          <span
            className="font-mono text-xs text-muted-foreground cursor-pointer hover:text-foreground"
            title="Click to copy ID"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(shortId);
              toast.success(`Copied: ${shortId}`);
            }}
          >
            {shortId}
          </span>
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
        const isReview = builtForReviewIds.has(row.original.id);
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
              isBuiltForReview={isReview}
              onApproveReview={isReview ? onApproveReview : undefined}
              onRejectReview={isReview ? onRejectReview : undefined}
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
              <DropdownMenuRadioGroup value={String(row.original.priority)} onValueChange={(v) => onUpdateBeat(row.original.id, { priority: Number(v) as BeatPriority })}>
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
                onValueChange={(v) => onUpdateBeat(row.original.id, { profileId: v })}
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

  if (onShipBeat) {
    columns.push({
      id: "ship",
      header: "",
      size: 100,
      minSize: 100,
      maxSize: 100,
      enableSorting: false,
      cell: ({ row }) => {
        const beat = row.original;
        const isTerminal = beat.state === "shipped" || beat.state === "abandoned" || beat.state === "closed";
        if (isTerminal || beat.type === "gate") return null;
        if (isTransitionLocked(beat.labels ?? [])) return null;
        if (beat.isAgentClaimable === false) {
          return (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-amber-100 text-amber-700">
              Human next
            </span>
          );
        }
        const isActiveShipping = Boolean(shippingByBeatId[beat.id]);
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

  // State column: placed rightmost so it sits after the run/ship column.
  // Uses percentage width via meta so it can grow and consume space from the title column.
  columns.push({
    accessorKey: "state",
    header: "State",
    meta: { widthPercent: "15%" },
    cell: ({ row }) => {
      const isRolling = Boolean(shippingByBeatId[row.original.id]);
      const isLocked = isTransitionLocked(row.original.labels ?? []);
      const state = row.original.state;
      const isTerminal = state === "shipped" || state === "abandoned" || state === "closed";
      const pulseClass = isRolling && !isTerminal ? "animate-pulse" : "";
      return (
        <div className="flex items-center gap-0.5">
          <VerificationButtons
            beat={row.original}
            onUpdateBeat={onUpdateBeat}
            isRolling={isRolling}
          />
          {onUpdateBeat && !isLocked ? (() => {
            const workflow = builtinProfileDescriptor(row.original.profileId);
            const nextStates = validNextStates(state, workflow);
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
                    onValueChange={(v) => onUpdateBeat(row.original.id, { state: v })}
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
          <RejectButton beat={row.original} onUpdateBeat={onUpdateBeat} onRejectBeat={onRejectBeat} isRolling={isRolling} />
        </div>
      );
    },
  });

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

// ── Deprecated re-exports ───────────────────────────────────

/** @deprecated Use BeatColumnOpts */
export type BeadColumnOpts = BeatColumnOpts;
/** @deprecated Use getBeatColumns */
export const getBeadColumns = getBeatColumns;
/** @deprecated Use beatColumns */
export const beadColumns = beatColumns;
/** @deprecated Use verifyBeatFields */
export const verifyBeadFields = verifyBeatFields;
/** @deprecated Use rejectBeatFields */
export const rejectBeadFields = rejectBeatFields;
