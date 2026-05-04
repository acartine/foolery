"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { Beat } from "@/lib/types";
import {
  countGroupedBeats,
  filterOverviewBeats,
  groupOverviewBeatsByState,
  overviewBeatLabel,
  overviewLeaseInfoForBeat,
} from "@/lib/beat-state-overview";
import type {
  BeatStateGroup,
  OverviewLeaseInfo,
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
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
  streamingProgress: StreamingProgress;
}

export function BeatStateOverviewScreen({
  isLoading,
  loadError,
  isDegradedError,
  beats,
  showRepoColumn,
  isAllRepositories,
  leaseInfoByBeatKey,
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
    && beats.length === 0;

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
      ) : beats.length === 0 ? (
        <OverviewEmptyState label="No beats found." />
      ) : (
        <BeatStateOverview
          beats={overviewBeats}
          showRepoColumn={showRepoColumn}
          isAllRepositories={isAllRepositories}
          leaseInfoByBeatKey={leaseInfoByBeatKey}
          onOpenBeat={onOpenBeat}
        />
      )}
    </div>
  );
}

function BeatStateOverview({
  beats,
  showRepoColumn,
  isAllRepositories,
  leaseInfoByBeatKey,
  onOpenBeat,
}: {
  beats: Beat[];
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
}) {
  const groups = useMemo(
    () => groupOverviewBeatsByState(beats),
    [beats],
  );
  const groupedCount = countGroupedBeats(groups);

  return (
    <div
      className="space-y-3"
      data-testid="beat-state-overview"
    >
      <div className={
        "flex flex-wrap items-center justify-between"
        + " gap-2 border-b border-border/70 pb-2"
      }>
        <h2 className="text-sm font-semibold tracking-tight">
          State overview
        </h2>
        <div className={
          "rounded-sm border bg-muted/30"
          + " px-2 py-0.5 text-[11px] text-muted-foreground"
        }>
          {groupedCount} beat{groupedCount === 1 ? "" : "s"}
        </div>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className={
          "grid min-w-full grid-flow-col"
          + " auto-cols-[minmax(8.5rem,calc((100%_-_3.5rem)/8))] gap-2"
        }>
          {groups.map((group) => (
            <BeatStateColumn
              key={group.state}
            group={group}
            showRepoColumn={showRepoColumn}
            isAllRepositories={isAllRepositories}
            leaseInfoByBeatKey={leaseInfoByBeatKey}
            onOpenBeat={onOpenBeat}
          />
          ))}
        </div>
      </div>
    </div>
  );
}

function BeatStateColumn({
  group,
  showRepoColumn,
  isAllRepositories,
  leaseInfoByBeatKey,
  onOpenBeat,
}: {
  group: BeatStateGroup;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
}) {
  return (
    <section
      className={
        "min-w-0 overflow-hidden border border-border/70"
        + " bg-background"
      }
      data-testid={`beat-state-group-${group.state}`}
    >
      <div className={
        "flex h-8 items-center justify-between gap-2"
        + " border-b border-border/70 bg-muted/35 px-2"
      }>
        <div className="min-w-0">
          <BeatStateBadge
            state={group.state}
            label={overviewStateLabel(group.state)}
            className="h-4 max-w-full truncate rounded-sm px-1 text-[10px]"
          />
        </div>
        <span className={
          "rounded-sm bg-background px-1.5 py-0.5"
          + " text-[10px] tabular-nums text-muted-foreground"
        }>
          {group.beats.length}
        </span>
      </div>
      <div className="divide-y divide-border/60">
        {group.beats.length > 0 ? (
          group.beats.map((beat) => (
            <BeatOverviewTile
              key={overviewTileKey(beat)}
              beat={beat}
              showRepoColumn={showRepoColumn}
              isAllRepositories={isAllRepositories}
              leaseInfo={leaseInfoForTile(
                beat,
                leaseInfoByBeatKey,
              )}
              onOpenBeat={onOpenBeat}
            />
          ))
        ) : (
          <div
            className="px-2 py-2 text-[10px] text-muted-foreground"
            data-testid="beat-state-empty-column"
          >
            No beats
          </div>
        )}
      </div>
    </section>
  );
}

function BeatOverviewTile({
  beat,
  showRepoColumn,
  isAllRepositories,
  leaseInfo,
  onOpenBeat,
}: {
  beat: Beat;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfo: OverviewLeaseInfo | null;
  onOpenBeat: (beat: Beat) => void;
}) {
  const repoLabel = showRepoColumn
    ? repoDisplayName(beat)
    : null;
  const contextItems = overviewContextItems(beat, repoLabel);

  return (
    <button
      type="button"
      className={
        "block w-full px-2 py-1.5 text-left"
        + " transition-colors hover:bg-muted/35"
        + " focus-visible:outline-none"
        + " focus-visible:ring-2 focus-visible:ring-ring"
      }
      data-testid="beat-overview-tile"
      title={beat.title}
      onClick={() => onOpenBeat(beat)}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={
          "min-w-0 truncate font-mono text-[10px]"
          + " leading-4 text-muted-foreground"
        }>
          {overviewBeatLabel(beat, isAllRepositories)}
        </span>
        <BeatPriorityBadge
          priority={beat.priority}
          className="h-4 rounded-sm px-1 text-[10px]"
        />
      </div>
      <div className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug">
        {beat.title}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
        <BeatTypeBadge
          type={beat.type}
          className={
            "h-4 max-w-[8.5rem] rounded-sm px-1"
            + " text-[10px] [&>svg]:size-2.5"
          }
        />
        <span className="text-[10px] leading-4 text-muted-foreground">
          {relativeTime(beat.updated)}
        </span>
      </div>
      {contextItems.length > 0 && (
        <div className={
          "mt-0.5 flex min-w-0 flex-wrap gap-x-1.5"
          + " gap-y-0.5 text-[10px] leading-4 text-muted-foreground"
        }>
          {contextItems.map((item) => (
            <span
              key={item}
              className="max-w-full truncate"
            >
              {item}
            </span>
          ))}
        </div>
      )}
      {leaseInfo && (
        <LeaseInfoLine info={leaseInfo} />
      )}
    </button>
  );
}

function LeaseInfoLine({ info }: { info: OverviewLeaseInfo }) {
  const parts = [
    info.startedAt ? `Lease ${relativeTime(info.startedAt)}` : null,
    info.provider,
    info.model,
    info.version,
  ].filter(Boolean);

  if (parts.length === 0) return null;

  return (
    <div
      className={
        "mt-0.5 flex min-w-0 flex-wrap gap-x-1.5"
        + " gap-y-0.5 text-[10px] leading-4 text-ochre-700"
        + " dark:text-ochre-100"
      }
      data-testid="beat-overview-lease-info"
    >
      {parts.map((part) => (
        <span
          key={part}
          className="max-w-full truncate"
        >
          {part}
        </span>
      ))}
    </div>
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

const OVERVIEW_STATE_LABELS: Record<string, string> = {
  ready_for_plan_review: "Ready Plan Review",
  ready_for_implementation: "Ready Impl",
  ready_for_implementation_review: "Ready Impl Review",
  implementation_review: "Impl Review",
  ready_for_shipment: "Ready Shipment",
  ready_for_shipment_review: "Ready Ship Review",
  shipment_review: "Shipment Review",
};

function overviewStateLabel(state: string): string | undefined {
  return OVERVIEW_STATE_LABELS[state];
}

function overviewContextItems(
  beat: Beat,
  repoLabel: string | null,
): string[] {
  const items: string[] = [];
  if (beat.parent) {
    items.push(`Parent ${displayBeatLabel(beat.parent)}`);
  }
  if (repoLabel) {
    items.push(repoLabel);
  }
  return items;
}

function leaseInfoForTile(
  beat: Beat,
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>,
): OverviewLeaseInfo | null {
  const byTile = leaseInfoByBeatKey[overviewTileKey(beat)];
  const byId = leaseInfoByBeatKey[beat.id];
  return overviewLeaseInfoForBeat(beat, byTile ?? byId);
}

function overviewTileKey(
  beat: Beat,
): string {
  const record = beat as Beat & { _repoPath?: unknown };
  return typeof record._repoPath === "string"
    ? `${record._repoPath}:${beat.id}`
    : beat.id;
}
