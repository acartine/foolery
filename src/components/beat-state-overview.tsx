"use client";

import {
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";
import type {
  CSSProperties,
} from "react";
import type { Beat } from "@/lib/types";
import {
  buildOverviewStateTabs,
  DEFAULT_OVERVIEW_STATE_TAB,
  filterOverviewBeats,
  groupOverviewBeatsByState,
  overviewColumnWidthPx,
  visibleOverviewGroups,
} from "@/lib/beat-state-overview";
import type {
  BeatStateGroup,
  OverviewLeaseInfo,
  OverviewStateTabId,
} from "@/lib/beat-state-overview";
import { BeatStateBadge } from "@/components/beat-state-badge";
import { RepoSwitchLoadingState } from "@/components/repo-switch-loading-state";
import {
  StreamingProgressBar,
} from "@/components/streaming-progress-bar";
import type {
  StreamingProgress,
} from "@/app/beats/use-streaming-progress";
import {
  BeatStateOverviewTabs,
} from "@/components/beat-state-overview-tabs";
import {
  BeatOverviewTile,
  leaseInfoForOverviewTile,
  overviewTileKey,
} from "@/components/beat-overview-tile";
import {
  useElementWidth,
} from "@/components/use-element-width";
import {
  useOverviewColumnWatermark,
} from "@/components/use-overview-column-watermark";

interface BeatStateOverviewScreenProps {
  isLoading: boolean;
  loadError: string | null;
  isDegradedError: boolean;
  beats: Beat[];
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
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
  onFocusLeaseSession,
  onReleaseBeat,
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
          onFocusLeaseSession={onFocusLeaseSession}
          onReleaseBeat={onReleaseBeat}
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
  onFocusLeaseSession,
  onReleaseBeat,
}: {
  beats: Beat[];
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
}) {
  const [activeTab, setActiveTab] = useState<OverviewStateTabId>(
    DEFAULT_OVERVIEW_STATE_TAB,
  );
  const tabs = useMemo(
    () => buildOverviewStateTabs(beats),
    [beats],
  );
  const groups = useMemo(
    () => groupOverviewBeatsByState(beats, activeTab),
    [beats, activeTab],
  );
  const visibleGroups = useMemo(
    () => visibleOverviewGroups(groups),
    [groups],
  );
  const visibleColumnCount = visibleGroups.length;
  const scrollportRef = useRef<HTMLDivElement | null>(null);
  const scrollportWidth = useElementWidth(scrollportRef);
  const sizingColumnCount = useOverviewColumnWatermark({
    tabId: activeTab,
    visibleColumnCount,
  });
  const columnWidth = overviewColumnWidthPx(
    scrollportWidth,
    sizingColumnCount,
  );
  const gridStyle = {
    "--overview-column-width": `${columnWidth}px`,
  } as CSSProperties;

  return (
    <div
      className="space-y-3"
      data-testid="beat-state-overview"
    >
      <BeatStateOverviewTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div
        className="overflow-x-auto pb-2"
        data-testid="beat-state-overview-scrollport"
        ref={scrollportRef}
      >
        {visibleGroups.length > 0 ? (
          <div
            className={
              "grid min-w-full grid-flow-col"
              + " auto-cols-[var(--overview-column-width)] gap-2"
            }
            data-testid="beat-state-overview-grid"
            style={gridStyle}
          >
            {visibleGroups.map((group) => (
              <BeatStateColumn
                key={group.state}
              group={group}
              showRepoColumn={showRepoColumn}
              isAllRepositories={isAllRepositories}
              leaseInfoByBeatKey={leaseInfoByBeatKey}
              onOpenBeat={onOpenBeat}
              onFocusLeaseSession={onFocusLeaseSession}
              onReleaseBeat={onReleaseBeat}
            />
            ))}
          </div>
        ) : (
          <OverviewEmptyState label="No beats in this group." />
        )}
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
  onFocusLeaseSession,
  onReleaseBeat,
}: {
  group: BeatStateGroup;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
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
        "flex min-h-7 items-center justify-between gap-1.5"
        + " border-b border-border/70 bg-muted/35 px-2 py-1"
      }>
        <div className="flex min-h-4 min-w-0 flex-1 items-center">
          <BeatStateBadge
            state={group.state}
            label={overviewStateLabel(group.state)}
            className={
              "h-auto max-w-full justify-start whitespace-normal"
              + " rounded-sm px-1 py-px text-[8px] leading-3"
            }
          />
        </div>
        <span className={
          "flex h-4 shrink-0 items-center rounded-sm bg-background"
          + " px-1.5 text-[9px] leading-none tabular-nums"
          + " text-muted-foreground"
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
              leaseInfo={leaseInfoForOverviewTile(
                beat,
                leaseInfoByBeatKey,
              )}
              onOpenBeat={onOpenBeat}
              onFocusLeaseSession={onFocusLeaseSession}
              onReleaseBeat={onReleaseBeat}
            />
          ))
        ) : (
          <div
            className="px-2 py-2 text-[9px] text-muted-foreground"
            data-testid="beat-state-empty-column"
          >
            No beats
          </div>
        )}
      </div>
    </section>
  );
}

function OverviewDegradedBanner(
  { message }: { message: string | null },
) {
  return (
    <div className={
      "mb-2 flex items-center gap-2 rounded-md"
      + " border border-feature-400 bg-feature-100"
      + " px-3 py-2 text-xs text-feature-700"
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
      + " py-6 text-xs text-muted-foreground"
    }>
      {label}
    </div>
  );
}

const OVERVIEW_STATE_LABELS: Record<string, string> = {
  ready_for_exploration: "Ready Exploration",
  ready_for_plan_review: "Ready Plan Review",
  ready_for_implementation: "Ready Impl",
  ready_for_implementation_review: "Ready Impl Review",
  implementation_review: "Impl Review",
  ready_for_shipment: "Ready Shipment",
  ready_for_shipment_review: "Ready Ship Review",
  shipment_review: "Shipment Review",
  ready_to_evaluate: "Ready Evaluate",
};

function overviewStateLabel(state: string): string | undefined {
  return OVERVIEW_STATE_LABELS[state];
}
