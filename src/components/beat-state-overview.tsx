"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { Beat } from "@/lib/types";
import {
  countGroupedBeats,
  filterOverviewBeats,
  groupBeatsByState,
  normalizeOverviewState,
} from "@/lib/beat-state-overview";
import { displayBeatLabel } from "@/lib/beat-display";
import { BeatStateBadge } from "@/components/beat-state-badge";
import { BeatPriorityBadge } from "@/components/beat-priority-badge";
import { BeatTypeBadge } from "@/components/beat-type-badge";
import { RepoSwitchLoadingState } from "@/components/repo-switch-loading-state";
import {
  StreamingProgressBar,
} from "@/components/streaming-progress-bar";
import { relativeTime } from "@/components/beat-column-time";
import type {
  StreamingProgress,
} from "@/app/beats/use-streaming-progress";

interface BeatStateOverviewScreenProps {
  isLoading: boolean;
  loadError: string | null;
  isDegradedError: boolean;
  beats: Beat[];
  showRepoColumn: boolean;
  onOpenBeat: (beat: Beat) => void;
  streamingProgress: StreamingProgress;
}

export function BeatStateOverviewScreen({
  isLoading,
  loadError,
  isDegradedError,
  beats,
  showRepoColumn,
  onOpenBeat,
  streamingProgress,
}: BeatStateOverviewScreenProps) {
  const overviewBeats = useMemo(
    () => filterOverviewBeats(beats),
    [beats],
  );
  const isStreamActive =
    streamingProgress.isStreaming
    || (
      streamingProgress.isComplete
      && streamingProgress.totalRepos > 0
    );

  if (isLoading && !isStreamActive) {
    return (
      <RepoSwitchLoadingState
        data-testid="repo-switch-loading-overview"
        label="Loading beats..."
      />
    );
  }
  if (loadError && !isDegradedError) {
    return (
      <div className={
        "flex items-center justify-center"
        + " py-6 text-sm text-destructive"
      }>
        Failed to load beats: {loadError}
      </div>
    );
  }

  const streamingEmpty =
    streamingProgress.isStreaming
    && overviewBeats.length === 0;
  const allReposEmpty =
    streamingProgress.isComplete
    && streamingProgress.totalRepos > 0
    && overviewBeats.length === 0;

  return (
    <div
      className="overflow-x-hidden"
      data-testid="beat-state-overview-screen"
    >
      {isDegradedError && (
        <OverviewDegradedBanner message={loadError} />
      )}
      {isStreamActive && (
        <StreamingProgressBar
          progress={streamingProgress}
        />
      )}
      {streamingEmpty ? (
        <OverviewEmptyState label="Loading repositories..." />
      ) : allReposEmpty ? (
        <OverviewEmptyState
          label="No results found across all repositories."
        />
      ) : overviewBeats.length === 0 ? (
        <OverviewEmptyState label="No beats found." />
      ) : (
        <BeatStateOverview
          beats={overviewBeats}
          showRepoColumn={showRepoColumn}
          onOpenBeat={onOpenBeat}
        />
      )}
    </div>
  );
}

function BeatStateOverview({
  beats,
  showRepoColumn,
  onOpenBeat,
}: {
  beats: Beat[];
  showRepoColumn: boolean;
  onOpenBeat: (beat: Beat) => void;
}) {
  const groups = useMemo(
    () => groupBeatsByState(beats),
    [beats],
  );
  const groupedCount = countGroupedBeats(groups);

  return (
    <div
      className="space-y-4"
      data-testid="beat-state-overview"
    >
      <div className={
        "flex flex-wrap items-center justify-between"
        + " gap-3 border-b border-border/70 pb-2"
      }>
        <h2 className="text-base font-semibold tracking-tight">
          Overview
        </h2>
        <div className={
          "rounded-md border bg-muted/30"
          + " px-2.5 py-1 text-xs text-muted-foreground"
        }>
          {groupedCount} beat{groupedCount === 1 ? "" : "s"}
        </div>
      </div>
      <div className="space-y-4">
        {groups.map((group) => (
          <section
            key={group.state}
            className="space-y-2"
            data-testid={`beat-state-group-${group.state}`}
          >
            <div className={
              "flex flex-wrap items-center justify-between"
              + " gap-2 border-b border-border/50 pb-1.5"
            }>
              <BeatStateBadge state={group.state} />
              <span className="text-xs text-muted-foreground">
                {group.beats.length}
              </span>
            </div>
            <div className={
              "grid gap-2 sm:grid-cols-2"
              + " xl:grid-cols-3 2xl:grid-cols-4"
            }>
              {group.beats.map((beat) => (
                <BeatOverviewTile
                  key={overviewTileKey(beat)}
                  beat={beat}
                  showRepoColumn={showRepoColumn}
                  onOpenBeat={onOpenBeat}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function BeatOverviewTile({
  beat,
  showRepoColumn,
  onOpenBeat,
}: {
  beat: Beat;
  showRepoColumn: boolean;
  onOpenBeat: (beat: Beat) => void;
}) {
  const repoLabel = showRepoColumn
    ? repoDisplayName(beat)
    : null;

  return (
    <button
      type="button"
      className={
        "min-h-[128px] rounded-md border border-border/80"
        + " bg-card px-3 py-2 text-left shadow-sm"
        + " transition-colors hover:border-primary/45"
        + " hover:bg-muted/30 focus-visible:outline-none"
        + " focus-visible:ring-2 focus-visible:ring-ring"
      }
      title={beat.title}
      onClick={() => onOpenBeat(beat)}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-muted-foreground">
            {displayBeatLabel(beat.id, beat.aliases)}
          </div>
          <div className="mt-1 line-clamp-2 text-sm font-medium">
            {beat.title}
          </div>
        </div>
        <BeatPriorityBadge
          priority={beat.priority}
          className="shrink-0"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <BeatTypeBadge type={beat.type} />
        <BeatStateBadge
          state={normalizeOverviewState(beat.state)}
        />
      </div>
      <div className={
        "mt-2 flex flex-wrap items-center gap-x-2"
        + " gap-y-1 text-[11px] text-muted-foreground"
      }>
        <span>Updated {relativeTime(beat.updated)}</span>
        {beat.parent && (
          <span>Parent {displayBeatLabel(beat.parent)}</span>
        )}
        {repoLabel && <span>{repoLabel}</span>}
      </div>
    </button>
  );
}

function OverviewDegradedBanner(
  { message }: { message: string | null },
) {
  return (
    <div className={
      "mb-2 flex items-center gap-2 rounded-md"
      + " border border-feature-400 bg-feature-100"
      + " px-3 py-2 text-sm text-feature-700"
      + " dark:border-feature-700"
      + " dark:bg-feature-700 dark:text-feature-100"
    }>
      <AlertTriangle
        className="size-4 shrink-0"
      />
      <span>{message}</span>
    </div>
  );
}

function OverviewEmptyState(
  { label }: { label: string },
) {
  return (
    <div className={
      "flex items-center justify-center"
      + " py-6 text-sm text-muted-foreground"
    }>
      {label}
    </div>
  );
}

function repoDisplayName(
  beat: Beat,
): string | null {
  const record = beat as Beat & {
    _repoName?: unknown;
    _repoPath?: unknown;
  };
  if (
    typeof record._repoName === "string"
    && record._repoName.trim().length > 0
  ) {
    return record._repoName.trim();
  }
  if (
    typeof record._repoPath === "string"
    && record._repoPath.trim().length > 0
  ) {
    const path = record._repoPath.trim();
    return path.split("/").filter(Boolean).pop() ?? path;
  }
  return null;
}

function overviewTileKey(
  beat: Beat,
): string {
  const record = beat as Beat & { _repoPath?: unknown };
  return typeof record._repoPath === "string"
    ? `${record._repoPath}:${beat.id}`
    : beat.id;
}
