"use client";

import {
  forwardRef,
} from "react";
import { EyeOff } from "lucide-react";
import type {
  CSSProperties,
  ReactNode,
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
            onHideColumn={props.onHideColumn}
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
          onHideColumn={props.onHideColumn}
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
  onHideColumn,
}: {
  group: BeatStateGroup;
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
        showHideControl={showHideControl}
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
  showHideControl,
  onHideColumn,
}: {
  group: BeatStateGroup;
  showHideControl: boolean;
  onHideColumn: (state: string) => void;
}) {
  return (
    <div className={
      "flex min-h-7 flex-wrap items-start gap-x-1.5 gap-y-0.5"
      + " border-b border-border/70 bg-muted/35 px-2 py-1"
    }>
      <div className="flex min-w-0 flex-1 items-start">
        <BeatStateBadge
          state={group.state}
          label={overviewStateLabel(group.state)}
          className={
            "h-auto max-w-full min-w-0 shrink justify-start"
            + " overflow-visible whitespace-normal break-words rounded-sm"
            + " px-1 py-px text-left text-[8px] leading-3"
          }
        />
      </div>
      <BeatStateColumnCount
        group={group}
        showHideControl={showHideControl}
        onHideColumn={onHideColumn}
      />
    </div>
  );
}

function BeatStateColumnCount({
  group,
  showHideControl,
  onHideColumn,
}: {
  group: BeatStateGroup;
  showHideControl: boolean;
  onHideColumn: (state: string) => void;
}) {
  return (
    <div
      className={
        "ml-auto flex min-w-0 flex-wrap items-center"
        + " justify-end gap-x-1 gap-y-0.5"
      }
    >
      {showHideControl && (
        <button
          type="button"
          className={
            "inline-flex size-4 items-center justify-center"
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
  terminated: "Terminated",
};

function overviewStateLabel(state: string): string | undefined {
  return OVERVIEW_STATE_LABELS[state];
}

function overviewColumnLabel(state: string): string {
  return overviewStateLabel(state) ?? state.replaceAll("_", " ");
}
