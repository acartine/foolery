"use client";

import {
  forwardRef,
} from "react";
import type {
  CSSProperties,
  ReactNode,
} from "react";
import type { Beat } from "@/lib/types";
import {
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
  onHideEmptyColumn: (state: string) => void;
  toolbarEnd?: ReactNode;
}

type OverviewStateGridProps = Omit<
  OverviewStateMatrixProps,
  "tabs" | "activeTab" | "onTabChange" | "toolbarEnd"
>;

export const OverviewStateMatrix = forwardRef<
  HTMLDivElement,
  OverviewStateMatrixProps
>(function OverviewStateMatrix(
  props,
  scrollportRef,
) {
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
        ref={scrollportRef}
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
            onHideEmptyColumn={props.onHideEmptyColumn}
          />
        ) : (
          <OverviewMatrixEmptyState />
        )}
      </div>
    </div>
  );
});

function OverviewStateGrid(props: OverviewStateGridProps) {
  return (
    <div
      className={
        "grid min-w-full grid-flow-col"
        + " auto-cols-[var(--overview-column-width)] gap-2"
      }
      data-testid="beat-state-overview-grid"
      style={props.gridStyle}
    >
      {props.visibleGroups.map((group) => (
        <BeatStateColumn
          key={group.state}
          group={group}
          showRepoColumn={props.showRepoColumn}
          isAllRepositories={props.isAllRepositories}
          leaseInfoByBeatKey={props.leaseInfoByBeatKey}
          onOpenBeat={props.onOpenBeat}
          onFocusLeaseSession={props.onFocusLeaseSession}
          onReleaseBeat={props.onReleaseBeat}
          onHideEmptyColumn={props.onHideEmptyColumn}
        />
      ))}
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
  onHideEmptyColumn,
}: {
  group: BeatStateGroup;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>;
  onOpenBeat: (beat: Beat) => void;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
  onHideEmptyColumn: (state: string) => void;
}) {
  const showHideControl = shouldShowOverviewColumnHideControl(group);

  return (
    <section
      className={
        "min-w-0 overflow-hidden border border-border/70"
        + " bg-background"
      }
      data-testid={`beat-state-group-${group.state}`}
    >
      <BeatStateColumnHeader
        group={group}
        showHideControl={showHideControl}
        onHideEmptyColumn={onHideEmptyColumn}
      />
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

function BeatStateColumnHeader({
  group,
  showHideControl,
  onHideEmptyColumn,
}: {
  group: BeatStateGroup;
  showHideControl: boolean;
  onHideEmptyColumn: (state: string) => void;
}) {
  return (
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
      <BeatStateColumnCount
        group={group}
        showHideControl={showHideControl}
        onHideEmptyColumn={onHideEmptyColumn}
      />
    </div>
  );
}

function BeatStateColumnCount({
  group,
  showHideControl,
  onHideEmptyColumn,
}: {
  group: BeatStateGroup;
  showHideControl: boolean;
  onHideEmptyColumn: (state: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {showHideControl && (
        <button
          type="button"
          className={
            "rounded-sm px-1 text-[9px] leading-4"
            + " text-muted-foreground hover:bg-background"
            + " hover:text-foreground"
          }
          data-testid="beat-state-empty-column-hide"
          aria-label={
            `Hide empty ${overviewColumnLabel(group.state)} column`
          }
          onClick={() => onHideEmptyColumn(group.state)}
        >
          Hide
        </button>
      )}
      <span className={
        "flex h-4 items-center rounded-sm bg-background"
        + " px-1.5 text-[9px] leading-none tabular-nums"
        + " text-muted-foreground"
      }>
        {group.beats.length}
      </span>
    </div>
  );
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
};

function overviewStateLabel(state: string): string | undefined {
  return OVERVIEW_STATE_LABELS[state];
}

function overviewColumnLabel(state: string): string {
  return overviewStateLabel(state) ?? state.replaceAll("_", " ");
}
