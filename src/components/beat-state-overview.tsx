"use client";

import {
  useCallback,
  useEffect,
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
  hideOverviewIntroducedColumn,
  nextOverviewIntroducedColumns,
  overviewColumnWidthPx,
  renderableOverviewGroups,
} from "@/lib/beat-state-overview";
import type {
  BeatStateGroup,
  OverviewIntroducedColumnStates,
  OverviewLeaseInfo,
  OverviewStateTabId,
} from "@/lib/beat-state-overview";
import type {
  OverviewSetlistFilterOption,
  OverviewTagFilterOption,
} from "@/lib/beat-state-overview-filters";
import { RepoSwitchLoadingState } from "@/components/repo-switch-loading-state";
import {
  StreamingProgressBar,
} from "@/components/streaming-progress-bar";
import type {
  StreamingProgress,
} from "@/app/beats/use-streaming-progress";
import {
  useElementWidth,
} from "@/components/use-element-width";
import {
  useOverviewColumnWatermark,
} from "@/components/use-overview-column-watermark";
import {
  StaleBeatGroomingDialog,
} from "@/components/stale-beat-grooming-dialog";
import {
  OverviewStateMatrix,
} from "@/components/beat-state-overview-matrix";
import {
  BeatOverviewFilterToolbar,
} from "@/components/beat-overview-filter-toolbar";
import {
  useBeatOverviewFilters,
} from "@/components/use-beat-overview-filters";

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
  const {
    tagOptions,
    setlistOptions,
    selectedTagSet,
    selectedSetlistSet,
    setlistsLoading,
    filteredBeats,
    handleTagCheckedChange,
    handleSetlistCheckedChange,
    handleClearFilters,
  } = useBeatOverviewFilters(beats);
  const tabs = useMemo(
    () => buildOverviewStateTabs(filteredBeats),
    [filteredBeats],
  );
  const groups = useMemo(
    () => groupOverviewBeatsByState(filteredBeats, activeTab),
    [filteredBeats, activeTab],
  );
  const introducedColumns = useOverviewIntroducedColumns({
    tabId: activeTab,
    groups,
  });
  const visibleGroups = useMemo(
    () => renderableOverviewGroups(
      activeTab,
      groups,
      introducedColumns.introducedStates,
    ),
    [activeTab, groups, introducedColumns.introducedStates],
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
    <OverviewStateMatrix
      ref={scrollportRef}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      visibleGroups={visibleGroups}
      gridStyle={gridStyle}
      showRepoColumn={showRepoColumn}
      isAllRepositories={isAllRepositories}
      leaseInfoByBeatKey={leaseInfoByBeatKey}
      onOpenBeat={onOpenBeat}
      onFocusLeaseSession={onFocusLeaseSession}
      onReleaseBeat={onReleaseBeat}
      onHideEmptyColumn={introducedColumns.onHideEmptyColumn}
      toolbarEnd={(
        <OverviewToolbarEnd
          beats={beats}
          isAllRepositories={isAllRepositories}
          onOpenBeat={onOpenBeat}
          tagOptions={tagOptions}
          setlistOptions={setlistOptions}
          selectedTagSet={selectedTagSet}
          selectedSetlistSet={selectedSetlistSet}
          setlistsLoading={setlistsLoading}
          onTagCheckedChange={handleTagCheckedChange}
          onSetlistCheckedChange={handleSetlistCheckedChange}
          onClearFilters={handleClearFilters}
        />
      )}
    />
  );
}

function OverviewToolbarEnd({
  beats,
  isAllRepositories,
  onOpenBeat,
  tagOptions,
  setlistOptions,
  selectedTagSet,
  selectedSetlistSet,
  setlistsLoading,
  onTagCheckedChange,
  onSetlistCheckedChange,
  onClearFilters,
}: {
  beats: Beat[];
  isAllRepositories: boolean;
  onOpenBeat: (beat: Beat) => void;
  tagOptions: readonly OverviewTagFilterOption[];
  setlistOptions: readonly OverviewSetlistFilterOption[];
  selectedTagSet: ReadonlySet<string>;
  selectedSetlistSet: ReadonlySet<string>;
  setlistsLoading: boolean;
  onTagCheckedChange: (tagId: string, checked: boolean) => void;
  onSetlistCheckedChange: (setlistId: string, checked: boolean) => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
      <BeatOverviewFilterToolbar
        tagOptions={tagOptions}
        setlistOptions={setlistOptions}
        selectedTagIds={selectedTagSet}
        selectedSetlistIds={selectedSetlistSet}
        setlistsLoading={setlistsLoading}
        onTagCheckedChange={onTagCheckedChange}
        onSetlistCheckedChange={onSetlistCheckedChange}
        onClearFilters={onClearFilters}
      />
      <StaleBeatGroomingDialog
        beats={beats}
        isAllRepositories={isAllRepositories}
        onOpenBeat={onOpenBeat}
      />
    </div>
  );
}

function useOverviewIntroducedColumns({
  tabId,
  groups,
}: {
  tabId: OverviewStateTabId;
  groups: readonly BeatStateGroup[];
}): {
  introducedStates: readonly string[];
  onHideEmptyColumn: (state: string) => void;
} {
  const [introducedColumns, setIntroducedColumns] =
    useState<OverviewIntroducedColumnStates>({});
  const currentIntroducedColumns = nextOverviewIntroducedColumns(
    introducedColumns,
    tabId,
    groups,
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setIntroducedColumns((current) =>
        nextOverviewIntroducedColumns(current, tabId, groups)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tabId, groups]);

  const onHideEmptyColumn = useCallback((state: string) => {
    setIntroducedColumns((current) =>
      hideOverviewIntroducedColumn(current, tabId, state)
    );
  }, [tabId]);

  return {
    introducedStates: currentIntroducedColumns[tabId] ?? [],
    onHideEmptyColumn,
  };
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
