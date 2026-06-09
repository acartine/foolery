"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { EyeOff } from "lucide-react";
import type {
  CSSProperties,
  ReactNode,
  RefObject,
} from "react";
import type { Beat } from "@/lib/types";
import {
  isTerminatedOverviewGroup,
  shouldShowOverviewColumnHideControl,
} from "@/lib/beat-state-overview";
import type {
  BeatStateGroup,
  OverviewLeaseInfo,
  OverviewStateTabId,
} from "@/lib/beat-state-overview";
import { BeatStateBadge } from "@/components/beat-state-badge";
import {
  BeatStateOverviewTabs,
} from "@/components/beat-state-overview-tabs";
import {
  BeatOverviewTile,
  leaseInfoForOverviewTile,
  overviewTileKey,
} from "@/components/beat-overview-tile";

interface OverviewStateMatrixProps {
  tabs: Array<{ id: OverviewStateTabId; label: string; count: number }>;
  activeTab: OverviewStateTabId;
  onTabChange: (tabId: OverviewStateTabId) => void;
  visibleGroups: BeatStateGroup[];
  gridStyle: CSSProperties;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
  onHideColumn: (state: string) => void;
  toolbarEnd?: ReactNode;
}

type OverviewStateGridProps = Omit<
  OverviewStateMatrixProps,
  "tabs" | "activeTab" | "onTabChange" | "toolbarEnd"
>;

export function OverviewStateMatrix(props: OverviewStateMatrixProps) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BeatStateOverviewTabs
          tabs={props.tabs}
          activeTab={props.activeTab}
          onTabChange={props.onTabChange}
        />
        {props.toolbarEnd}
      </div>
      <div
        className="overflow-x-auto pb-2"
        data-testid="beat-state-overview-scrollport"
      >
        {props.visibleGroups.length > 0 ? (
          <OverviewStateGrid
            visibleGroups={props.visibleGroups}
            gridStyle={props.gridStyle}
            showRepoColumn={props.showRepoColumn}
            isAllRepositories={props.isAllRepositories}
            leaseInfoByBeatKey={props.leaseInfoByBeatKey}
            onOpenBeat={props.onOpenBeat}
            onFocusLeaseSession={props.onFocusLeaseSession}
            onReleaseBeat={props.onReleaseBeat}
            onHideColumn={props.onHideColumn}
          />
        ) : (
          <OverviewMatrixEmptyState />
        )}
      </div>
    </div>
  );
}

function OverviewStateGrid(props: OverviewStateGridProps) {
  const headerHeight = useUniformOverviewHeaderHeight(
    props.visibleGroups,
  );

  return (
    <div
      className="grid min-w-full gap-2"
      data-testid="beat-state-overview-grid"
      style={props.gridStyle}
    >
      {props.visibleGroups.map((group) => (
        <BeatStateColumn
          key={group.state}
          group={group}
          headerHeight={headerHeight.height}
          onHeaderHeightChange={headerHeight.onHeaderHeightChange}
          showRepoColumn={props.showRepoColumn}
          isAllRepositories={props.isAllRepositories}
          leaseInfoByBeatKey={props.leaseInfoByBeatKey}
          onOpenBeat={props.onOpenBeat}
          onFocusLeaseSession={props.onFocusLeaseSession}
          onReleaseBeat={props.onReleaseBeat}
          onHideColumn={props.onHideColumn}
        />
      ))}
    </div>
  );
}

function BeatStateColumn({
  group,
  headerHeight,
  onHeaderHeightChange,
  showRepoColumn,
  isAllRepositories,
  leaseInfoByBeatKey,
  onOpenBeat,
  onFocusLeaseSession,
  onReleaseBeat,
  onHideColumn,
}: {
  group: BeatStateGroup;
  headerHeight?: number;
  onHeaderHeightChange: (state: string, height: number) => void;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
  onHideColumn: (state: string) => void;
}) {
  const showHideControl = shouldShowOverviewColumnHideControl(group);
  const showStateBadge = isTerminatedOverviewGroup(group.state);

  return (
    <section
      className={
        "min-w-0 border border-border/70"
        + " bg-background"
      }
      data-testid={`beat-state-group-${group.state}`}
    >
      <BeatStateColumnHeader
        group={group}
        headerHeight={headerHeight}
        showHideControl={showHideControl}
        onHeaderHeightChange={onHeaderHeightChange}
        onHideColumn={onHideColumn}
      />
      <div className="divide-y divide-border/60 overflow-hidden">
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
              showStateBadge={showStateBadge}
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

function BeatStateColumnHeader({
  group,
  headerHeight,
  showHideControl,
  onHeaderHeightChange,
  onHideColumn,
}: {
  group: BeatStateGroup;
  headerHeight?: number;
  showHideControl: boolean;
  onHeaderHeightChange: (state: string, height: number) => void;
  onHideColumn: (state: string) => void;
}) {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useOverviewHeaderMeasurement(
    group.state,
    onHeaderHeightChange,
    headerRef,
    contentRef,
  );

  return (
    <div
      className={
        "box-border min-h-7 border-b border-border/70"
        + " bg-muted/35 px-2 py-1"
      }
      data-testid="beat-state-column-header"
      ref={headerRef}
      style={headerHeight ? { height: headerHeight } : undefined}
    >
      <div
        className={
          "flex min-w-0 flex-wrap items-start"
          + " gap-x-1 gap-y-0.5"
        }
        data-testid="beat-state-column-header-content"
        ref={contentRef}
      >
        <div
          className="min-w-0 max-w-full flex-[1_1_3.25rem]"
          data-testid="beat-state-column-label"
        >
          <BeatStateBadge
            state={group.state}
            label={overviewStateLabel(group.state)}
            className={
              "block h-auto w-full max-w-full min-w-0"
              + " overflow-visible whitespace-normal wrap-anywhere"
              + " rounded-sm px-1 py-px text-left text-[8px] leading-3"
            }
          />
        </div>
        <BeatStateColumnActions
          group={group}
          showHideControl={showHideControl}
          onHideColumn={onHideColumn}
        />
      </div>
    </div>
  );
}

function BeatStateColumnActions({
  group,
  showHideControl,
  onHideColumn,
}: {
  group: BeatStateGroup;
  showHideControl: boolean;
  onHideColumn: (state: string) => void;
}) {
  return (
    <>
      {showHideControl && (
        <button
          type="button"
          className={
            "inline-flex size-4 shrink-0 items-center justify-center"
            + " rounded-sm text-muted-foreground"
            + " hover:bg-background hover:text-foreground"
          }
          data-testid="beat-state-column-hide"
          aria-label={
            `Hide ${overviewColumnLabel(group.state)} column`
          }
          title={`Hide ${overviewColumnLabel(group.state)} column`}
          onClick={() => onHideColumn(group.state)}
        >
          <EyeOff className="size-3" aria-hidden="true" />
        </button>
      )}
      <span className={
        "flex h-4 shrink-0 items-center rounded-sm bg-background"
        + " px-1.5 text-[9px] leading-none tabular-nums"
        + " text-muted-foreground"
      } data-testid="beat-state-column-count">
        {group.beats.length}
      </span>
    </>
  );
}

function useUniformOverviewHeaderHeight(
  groups: BeatStateGroup[],
): {
  height?: number;
  onHeaderHeightChange: (state: string, height: number) => void;
} {
  const heightsRef = useRef(new Map<string, number>());
  const [height, setHeight] = useState<number>();

  const recomputeHeight = useCallback(() => {
    const next = overviewHeaderMaxHeight(groups, heightsRef.current);
    setHeight((current) => current === next ? current : next);
  }, [groups]);

  const onHeaderHeightChange = useCallback((
    state: string,
    nextHeight: number,
  ) => {
    if (nextHeight > 0) {
      heightsRef.current.set(state, Math.ceil(nextHeight));
    } else {
      heightsRef.current.delete(state);
    }
    recomputeHeight();
  }, [recomputeHeight]);

  useLayoutEffect(() => {
    const visibleStates = new Set(groups.map((group) => group.state));
    for (const state of heightsRef.current.keys()) {
      if (!visibleStates.has(state)) heightsRef.current.delete(state);
    }
    recomputeHeight();
  }, [groups, recomputeHeight]);

  return { height, onHeaderHeightChange };
}

function overviewHeaderMaxHeight(
  groups: BeatStateGroup[],
  heights: Map<string, number>,
): number | undefined {
  let maxHeight = 0;
  for (const group of groups) {
    maxHeight = Math.max(maxHeight, heights.get(group.state) ?? 0);
  }
  return maxHeight > 0 ? maxHeight : undefined;
}

function useOverviewHeaderMeasurement(
  state: string,
  onHeightChange: (state: string, height: number) => void,
  headerRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
): void {
  useLayoutEffect(() => {
    const header = headerRef.current;
    const content = contentRef.current;
    if (!header || !content) return undefined;

    const updateHeight = () => {
      onHeightChange(state, measureOverviewHeaderHeight(header, content));
    };
    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef, headerRef, onHeightChange, state]);
}

function measureOverviewHeaderHeight(
  header: HTMLElement,
  content: HTMLElement,
): number {
  const style = window.getComputedStyle(header);
  const chromeHeight =
    cssPixels(style.borderTopWidth)
    + cssPixels(style.borderBottomWidth)
    + cssPixels(style.paddingTop)
    + cssPixels(style.paddingBottom);
  return Math.ceil(
    content.getBoundingClientRect().height + chromeHeight,
  );
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function OverviewMatrixEmptyState() {
  return (
    <div className={
      "flex items-center justify-center"
      + " py-6 text-xs text-muted-foreground"
    }>
      No beats in this group.
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
  terminated: "Terminated",
};

function overviewStateLabel(state: string): string | undefined {
  return OVERVIEW_STATE_LABELS[state];
}

function overviewColumnLabel(state: string): string {
  return overviewStateLabel(state) ?? state.replaceAll("_", " ");
}
