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
            + " bg-purple-100 text-purple-700"
            + " hover:bg-purple-200"
            + " dark:bg-purple-900/40"
            + " dark:text-purple-300"
            + " dark:hover:bg-purple-900/60"
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
            + " bg-rose-100 text-rose-700"
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
            + " bg-slate-100 text-slate-600"
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
