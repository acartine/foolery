"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Bead, BeadType, BeadStatus, BeadPriority } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { BeadTypeBadge } from "@/components/bead-type-badge";
import { BeadStatusBadge } from "@/components/bead-status-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ThumbsDown, ChevronRight, ChevronDown, X, Clapperboard, Square, Eye, ShieldCheck } from "lucide-react";
import { isWaveLabel, isInternalLabel, isReadOnlyLabel, extractWaveSlug, isTransitionLocked } from "@/lib/wave-slugs";

const BEAD_TYPES: BeadType[] = [
  "bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate",
];

const BEAD_STATUSES: BeadStatus[] = [
  "open", "in_progress", "blocked", "deferred", "closed",
];

const PRIORITIES: BeadPriority[] = [0, 1, 2, 3, 4];

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

export interface BeadColumnOpts {
  showRepoColumn?: boolean;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
  onTitleClick?: (bead: Bead) => void;
  onShipBead?: (bead: Bead) => void;
  shippingByBeadId?: Record<string, string>;
  onAbortShipping?: (beadId: string) => void;
  allLabels?: string[];
  builtForReviewIds?: Set<string>;
  onApproveReview?: (parentId: string) => void;
  onRejectReview?: (parentId: string) => void;
  /** Opens the rejection notes dialog for a bead instead of directly rejecting. */
  onRejectBead?: (bead: Bead) => void;
  /** Called when a bead should be closed (checks for children / cascade). */
  onCloseBead?: (beadId: string) => void;
  collapsedIds?: Set<string>;
  onToggleCollapse?: (id: string) => void;
  childCountMap?: Map<string, number>;
}

function VerificationButtons({
  bead,
  onUpdateBead,
  isRolling,
}: {
  bead: Bead;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
  isRolling?: boolean;
}) {
  const hasVerification = bead.labels?.includes("stage:verification");
  const hasTransition = isTransitionLocked(bead.labels ?? []);

  // Show auto-verification indicator when transition:verification is present
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

  if (!hasVerification || !onUpdateBead || isRolling) return null;

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded p-1 text-green-700 hover:bg-green-100"
        title="Verify (LGTM)"
        onClick={(e) => {
          e.stopPropagation();
          onUpdateBead(bead.id, verifyBeadFields());
        }}
      >
        <Check className="size-4" />
      </button>
    </>
  );
}

// Verification must remain atomic (single update mutation).
// A prior split flow (remove label, then close) repeatedly regressed into
// "label removed but bead still in_progress" when only one step completed.
export function verifyBeadFields(): UpdateBeadInput {
  return {
    status: "closed",
    removeLabels: ["stage:verification"],
  };
}

export function rejectBeadFields(bead: Bead): UpdateBeadInput {
  const currentLabels = bead.labels ?? [];
  const prev = currentLabels.find((l) => l.startsWith("attempts:"));
  const attemptNum = prev ? parseInt(prev.split(":")[1], 10) + 1 : 1;
  const removeLabels = ["stage:verification"];
  if (prev) removeLabels.push(prev);
  return {
    status: "open",
    removeLabels,
    labels: ["stage:retry", `attempts:${attemptNum}`],
  };
}

function RejectButton({
  bead,
  onUpdateBead,
  onRejectBead,
  isRolling,
}: {
  bead: Bead;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
  onRejectBead?: (bead: Bead) => void;
  isRolling?: boolean;
}) {
  const hasVerification = bead.labels?.includes("stage:verification");
  if (!hasVerification || (!onUpdateBead && !onRejectBead) || isRolling) return null;

  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded p-1 text-red-700 hover:bg-red-100"
      title="Reject"
      onClick={(e) => {
        e.stopPropagation();
        if (onRejectBead) {
          onRejectBead(bead);
        } else if (onUpdateBead) {
          onUpdateBead(bead.id, rejectBeadFields(bead));
        }
      }}
    >
      <ThumbsDown className="size-4" />
    </button>
  );
}

function AddLabelDropdown({
  beadId,
  existingLabels,
  onUpdateBead,
  allLabels = [],
}: {
  beadId: string;
  existingLabels: string[];
  onUpdateBead: (id: string, fields: UpdateBeadInput) => void;
  allLabels?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const availableLabels = allLabels.filter((l) => !existingLabels.includes(l));

  const addLabel = (label: string) => {
    onUpdateBead(beadId, { labels: [label] });
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

function TitleCell({ bead, onTitleClick, onUpdateBead, allLabels, isBuiltForReview, onApproveReview, onRejectReview }: {
  bead: Bead;
  onTitleClick?: (bead: Bead) => void;
  onUpdateBead?: (id: string, fields: UpdateBeadInput) => void;
  allLabels?: string[];
  isBuiltForReview?: boolean;
  onApproveReview?: (parentId: string) => void;
  onRejectReview?: (parentId: string) => void;
}) {
  const labels = bead.labels ?? [];
  const isOrchestrated = labels.some(isWaveLabel);
  const isLocked = isTransitionLocked(labels);
  const waveSlug = extractWaveSlug(labels);
  const visibleLabels = labels.filter((l) => !isInternalLabel(l));
  // Disable editing when transition:verification is active
  const effectiveOnUpdateBead = isLocked ? undefined : onUpdateBead;
  return (
    <div className="flex flex-col gap-0.5">
      {onTitleClick ? (
        <button
          type="button"
          title="Open beat details"
          className="font-medium text-left hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onTitleClick(bead);
          }}
        >
          {waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}{bead.title}
        </button>
      ) : (
        <span className="font-medium">{waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}{bead.title}</span>
      )}
      {isBuiltForReview && (
        <div className="mt-0.5 flex items-center gap-1.5 rounded border border-orange-200 bg-orange-50 px-2 py-1">
          <Eye className="size-3.5 text-orange-600 shrink-0" />
          <span className="text-xs font-semibold text-orange-700">Built for Review</span>
          {onApproveReview && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded p-0.5 text-green-700 hover:bg-green-100"
              title="Approve all — close children and parent"
              onClick={(e) => {
                e.stopPropagation();
                onApproveReview(bead.id);
              }}
            >
              <Check className="size-4" />
            </button>
          )}
          {onRejectReview && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded p-0.5 text-red-700 hover:bg-red-100"
              title="Reject all — return children to open"
              onClick={(e) => {
                e.stopPropagation();
                onRejectReview(bead.id);
              }}
            >
              <ThumbsDown className="size-4" />
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-muted-foreground text-xs">
          {relativeTime(bead.updated)}
        </span>
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
            {effectiveOnUpdateBead && !isReadOnlyLabel(label) && (
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-black/10 p-0.5 leading-none"
                title={`Remove ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  effectiveOnUpdateBead(bead.id, { removeLabels: [label] });
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {effectiveOnUpdateBead && (
          <AddLabelDropdown beadId={bead.id} existingLabels={labels} onUpdateBead={effectiveOnUpdateBead} allLabels={allLabels} />
        )}
      </div>
    </div>
  );
}

export function getBeadColumns(opts: BeadColumnOpts | boolean = false): ColumnDef<Bead>[] {
  const showRepoColumn = typeof opts === "boolean" ? opts : (opts.showRepoColumn ?? false);
  const onUpdateBead = typeof opts === "boolean" ? undefined : opts.onUpdateBead;
  const onTitleClick = typeof opts === "boolean" ? undefined : opts.onTitleClick;
  const onShipBead = typeof opts === "boolean" ? undefined : opts.onShipBead;
  const shippingByBeadId = typeof opts === "boolean" ? {} : (opts.shippingByBeadId ?? {});
  const onAbortShipping = typeof opts === "boolean" ? undefined : opts.onAbortShipping;
  const allLabels = typeof opts === "boolean" ? undefined : opts.allLabels;
  const builtForReviewIds = typeof opts === "boolean" ? new Set<string>() : (opts.builtForReviewIds ?? new Set<string>());
  const onApproveReview = typeof opts === "boolean" ? undefined : opts.onApproveReview;
  const onRejectReview = typeof opts === "boolean" ? undefined : opts.onRejectReview;
  const onRejectBead = typeof opts === "boolean" ? undefined : opts.onRejectBead;
  const onCloseBead = typeof opts === "boolean" ? undefined : opts.onCloseBead;
  const collapsedIds = typeof opts === "boolean" ? new Set<string>() : (opts.collapsedIds ?? new Set<string>());
  const onToggleCollapse = typeof opts === "boolean" ? undefined : opts.onToggleCollapse;
  const childCountMap = typeof opts === "boolean" ? new Map<string, number>() : (opts.childCountMap ?? new Map<string, number>());

  const columns: ColumnDef<Bead>[] = [
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
      size: 60,
      minSize: 60,
      maxSize: 60,
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
              bead={row.original}
              onTitleClick={onTitleClick}
              onUpdateBead={onUpdateBead}
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
        if (!onUpdateBead) return <BeadPriorityBadge priority={row.original.priority} />;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title="Change priority" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                <BeadPriorityBadge priority={row.original.priority} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={String(row.original.priority)} onValueChange={(v) => onUpdateBead(row.original.id, { priority: Number(v) as BeadPriority })}>
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
        if (!onUpdateBead) return <div className="flex items-center"><BeadTypeBadge type={row.original.type} /></div>;
        return (
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title="Change type" className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <BeadTypeBadge type={row.original.type} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={row.original.type} onValueChange={(v) => onUpdateBead(row.original.id, { type: v as BeadType })}>
                  {BEAD_TYPES.map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>{t}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 130,
      minSize: 130,
      maxSize: 130,
      cell: ({ row }) => {
        const isRolling = Boolean(shippingByBeadId[row.original.id]);
        const isLocked = isTransitionLocked(row.original.labels ?? []);
        const pulseClass = isRolling && row.original.status === "in_progress" ? "animate-pulse" : "";
        return (
          <div className="flex items-center gap-0.5">
            <VerificationButtons
              bead={row.original}
              onUpdateBead={onUpdateBead}
              isRolling={isRolling}
            />
            {onUpdateBead && !isLocked ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" title="Change status" className={`cursor-pointer ${pulseClass}`} onClick={(e) => e.stopPropagation()}>
                    <BeadStatusBadge status={row.original.status} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup value={row.original.status} onValueChange={(v) => {
                    if (v === "closed" && onCloseBead) {
                      onCloseBead(row.original.id);
                    } else {
                      onUpdateBead(row.original.id, { status: v as BeadStatus });
                    }
                  }}>
                    {BEAD_STATUSES.map((s) => (
                      <DropdownMenuRadioItem key={s} value={s}>{s.replace("_", " ")}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <BeadStatusBadge status={row.original.status} className={pulseClass} />
            )}
            <RejectButton bead={row.original} onUpdateBead={onUpdateBead} onRejectBead={onRejectBead} isRolling={isRolling} />
          </div>
        );
      },
    },
  ];

  if (onShipBead) {
    columns.push({
      id: "ship",
      header: "",
      size: 100,
      minSize: 100,
      maxSize: 100,
      enableSorting: false,
      cell: ({ row }) => {
        const bead = row.original;
        if (bead.status === "closed" || bead.type === "gate") return null;
        // Disable Ship button during auto-verification
        if (isTransitionLocked(bead.labels ?? [])) return null;
        const isActiveShipping = Boolean(shippingByBeadId[bead.id]);
        const hb = bead as unknown as { _hasChildren?: boolean };
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
                  onAbortShipping?.(bead.id);
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
              onShipBead(bead);
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

export const beadColumns = getBeadColumns({ showRepoColumn: false });
