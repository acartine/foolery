"use client";

import { useState } from "react";
import type { Beat, BeatPriority } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRight,
  ChevronDown,
  Clapperboard,
  X,
} from "lucide-react";
import { relativeTime } from "./beat-column-time";
import {
  isWaveLabel,
  isInternalLabel,
  isReadOnlyLabel,
  extractWaveSlug,
} from "@/lib/wave-slugs";

export const PRIORITIES: BeatPriority[] = [0, 1, 2, 3, 4];

export type UpdateBeatFn = (
  id: string,
  fields: UpdateBeatInput,
  repoPath?: string,
) => void;

export function formatLabel(val: string): string {
  return val
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const LABEL_COLORS = [
  "bg-rust-100 text-rust-700 dark:bg-rust-700/30 dark:text-rust-100",
  "bg-lake-100 text-lake-700 dark:bg-lake-700/30 dark:text-lake-100",
  "bg-moss-100 text-moss-700 dark:bg-moss-700/30 dark:text-moss-100",
  "bg-ochre-100 text-ochre-700 dark:bg-ochre-700/30 dark:text-ochre-100",
  "bg-clay-100 text-clay-800 dark:bg-clay-700/35 dark:text-clay-100",
  "bg-rust-100 text-rust-700 dark:bg-rust-700/30 dark:text-rust-100",
  "bg-gate-100 text-gate-700 dark:bg-gate-700/30 dark:text-gate-100",
  "bg-ochre-100 text-ochre-700 dark:bg-ochre-700/30 dark:text-ochre-100",
  "bg-mr-100 text-mr-700 dark:bg-mr-700/30 dark:text-mr-100",
  "bg-molecule-100 text-molecule-700 dark:bg-molecule-700/30 dark:text-molecule-100",
];

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

export function formatStateName(state: string): string {
  return state.replace(/_/g, " ");
}

export { relativeTime } from "./beat-column-time";

export function repoPathForBeat(
  beat: Beat,
): string | undefined {
  const record = beat as Beat & { _repoPath?: unknown };
  const repoPath = record._repoPath;
  return typeof repoPath === "string" && repoPath.trim().length > 0
    ? repoPath
    : undefined;
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

  const availableLabels = allLabels.filter(
    (l) => !existingLabels.includes(l),
  );

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
          className={
            "inline-flex items-center rounded px-1.5 py-0"
            + " text-[10px] font-semibold leading-none"
            + " bg-clay-100 text-clay-700"
            + " hover:bg-clay-200"
            + " dark:bg-clay-800/40"
            + " dark:text-clay-300"
            + " dark:hover:bg-clay-800/60"
          }
          onClick={(e) => e.stopPropagation()}
        >
          + Label
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-48"
      >
        <div className="p-1">
          <input
            type="text"
            placeholder="New label..."
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter"
                && newLabel.trim()
              ) {
                e.preventDefault();
                addLabel(newLabel.trim());
              }
              e.stopPropagation();
            }}
            className={
              "w-full px-2 py-1 text-xs border"
              + " rounded mb-1 outline-none"
              + " focus:ring-1 focus:ring-green-500"
            }
          />
        </div>
        {availableLabels.map((label) => (
          <DropdownMenuItem
            key={label}
            onClick={() => addLabel(label)}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TitleMetaBadges({
  beat,
  isOrchestrated,
  visibleLabels,
  onUpdateBeat,
  allLabels,
}: {
  beat: Beat;
  isOrchestrated: boolean;
  visibleLabels: string[];
  onUpdateBeat?: UpdateBeatFn;
  allLabels?: string[];
}) {
  const labels = beat.labels ?? [];
  return (
    <div
      className={
        "flex items-center gap-1 flex-wrap"
      }
    >
      <span className="text-muted-foreground text-xs">
        {relativeTime(beat.updated)}
      </span>
      {beat.requiresHumanAction && (
        <span
          className={
            "inline-flex items-center rounded"
            + " px-1 py-0 text-[10px]"
            + " font-semibold leading-none"
            + " bg-rust-100 text-rust-700"
          }
        >
          Human action
        </span>
      )}
      {isOrchestrated && (
        <span
          className={
            "inline-flex items-center gap-0.5"
            + " rounded px-1 py-0 text-[10px]"
            + " font-medium leading-none"
            + " bg-paper-100 text-ink-600"
          }
        >
          <Clapperboard className="size-2.5" />
          Orchestrated
        </span>
      )}
      {visibleLabels.map((label) => (
        <LabelBadge
          key={label}
          label={label}
          beat={beat}
          onUpdateBeat={onUpdateBeat}
        />
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
  );
}

function LabelBadge({
  label,
  beat,
  onUpdateBeat,
}: {
  label: string;
  beat: Beat;
  onUpdateBeat?: UpdateBeatFn;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-0.5"
        + " rounded px-1 py-0 text-[10px]"
        + " font-medium leading-none "
        + labelColor(label)
      }
    >
      {label}
      {onUpdateBeat
        && !isReadOnlyLabel(label) && (
        <button
          type="button"
          className={
            "ml-0.5 rounded-full"
            + " hover:bg-black/10"
            + " p-0.5 leading-none"
          }
          title={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onUpdateBeat(
              beat.id,
              { removeLabels: [label] },
              repoPathForBeat(beat),
            );
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

export type TitleRenderOpts = {
  collapsedIds: Set<string>;
  onToggleCollapse?: (id: string) => void;
  childCountMap: Map<string, number>;
  onTitleClick?: (beat: Beat) => void;
  onUpdateBeat?: UpdateBeatFn;
  allLabels?: string[];
};

export function InlineTitleContent({
  beat,
  opts,
}: {
  beat: Beat;
  opts: TitleRenderOpts;
}) {
  const hb = beat as unknown as {
    _depth?: number;
    _hasChildren?: boolean;
  };
  const depth = hb._depth ?? 0;
  const hasChildren = hb._hasChildren ?? false;
  const isCollapsed = opts.collapsedIds.has(beat.id);
  const Chevron = isCollapsed
    ? ChevronRight
    : ChevronDown;
  return (
    <div
      className="flex items-start gap-0.5 truncate"
      style={{ paddingLeft: `${depth * 16}px` }}
    >
      {hasChildren ? (
        <div
          className={
            "relative shrink-0"
            + " flex items-start w-3.5"
          }
        >
          {isCollapsed
            && opts.childCountMap.get(beat.id)
              != null && (
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
              {opts.childCountMap.get(beat.id)}
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
              "p-0 mt-0.5"
              + " text-muted-foreground"
              + " hover:text-foreground shrink-0"
            }
            onClick={(e) => {
              e.stopPropagation();
              opts.onToggleCollapse?.(beat.id);
            }}
          >
            <Chevron className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <span
          className="inline-block w-3.5 shrink-0"
        />
      )}
      <TitleCell
        beat={beat}
        onTitleClick={opts.onTitleClick}
        onUpdateBeat={opts.onUpdateBeat}
        allLabels={opts.allLabels}
      />
    </div>
  );
}

export function TitleCell({
  beat,
  onTitleClick,
  onUpdateBeat,
  allLabels,
}: {
  beat: Beat;
  onTitleClick?: (beat: Beat) => void;
  onUpdateBeat?: UpdateBeatFn;
  allLabels?: string[];
}) {
  const labels = beat.labels ?? [];
  const isOrchestrated = labels.some(isWaveLabel);
  const waveSlug = extractWaveSlug(labels);
  const visibleLabels = labels.filter(
    (l) => !isInternalLabel(l),
  );
  const wavePrefix = waveSlug ? (
    <span
      className={
        "text-xs font-mono"
        + " text-muted-foreground mr-1"
      }
    >
      [{waveSlug}]
    </span>
  ) : null;

  return (
    <div
      className={
        "min-w-0 flex flex-1 flex-col gap-0.5"
      }
    >
      {onTitleClick ? (
        <button
          type="button"
          title="Open beat details"
          className={
            "text-left font-medium"
            + " break-words hover:underline"
          }
          onClick={(e) => {
            e.stopPropagation();
            onTitleClick(beat);
          }}
        >
          {wavePrefix}
          {beat.title}
        </button>
      ) : (
        <span className="font-medium break-words">
          {wavePrefix}
          {beat.title}
        </span>
      )}
      <TitleMetaBadges
        beat={beat}
        isOrchestrated={isOrchestrated}
        visibleLabels={visibleLabels}
        onUpdateBeat={onUpdateBeat}
        allLabels={allLabels}
      />
    </div>
  );
}
