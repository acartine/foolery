"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Beat } from "@/lib/types";
import type { AgentInfo } from "@/components/beat-columns";
import { BeatTable } from "@/components/beat-table";
import {
  BeatDetailLightbox,
} from "@/components/beat-detail-lightbox";
import {
  FilterBar, type ViewPhase,
} from "@/components/filter-bar";
import {
  MergeBeatsDialog,
} from "@/components/merge-beats-dialog";
import { FinalCutView } from "@/components/final-cut-view";
import { RetakesView } from "@/components/retakes-view";
import {
  AgentHistoryView,
} from "@/components/agent-history-view";
import {
  DiagnosticsView,
} from "@/components/lease-audit-view";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { AlertTriangle } from "lucide-react";
import {
  isListBeatsView, parseBeatsView,
} from "@/lib/beats-view";
import { useBeatsQuery } from "./use-beats-query";
import { useAgentInfoMap } from "./use-agent-info-map";
import { useBulkActions } from "./use-bulk-actions";
import { useBeatActions } from "./use-beat-actions";
import { useBeatDetail } from "./use-beat-detail";
import { useBeatsScreenWarmup } from "@/hooks/use-beats-screen-warmup";

export {
  toActiveAgentInfo,
} from "./to-active-agent-info";

export default function BeatsPage() {
  return (
    <Suspense fallback={
      <div className={
        "flex items-center justify-center"
        + " py-6 text-muted-foreground"
      }>
        Loading beats...
      </div>
    }>
      <BeatsPageInner />
    </Suspense>
  );
}

function useBeatsPageState() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const detailBeatId = searchParams.get("beat");
  const detailRepo =
    searchParams.get("detailRepo") ?? undefined;
  const beatsView =
    parseBeatsView(searchParams.get("view"));
  const isListView = isListBeatsView(beatsView);
  const viewPhase: ViewPhase =
    beatsView === "active" ? "active" : "queues";
  const isActiveView = beatsView === "active";
  const { activeRepo, registeredRepos } = useAppStore();
  const { terminals } = useTerminalStore();

  const shippingByBeatId = terminals.reduce<
    Record<string, string>
  >((acc, t) => {
    if (t.status === "running") {
      acc[t.beatId] = t.sessionId;
    }
    return acc;
  }, {});

  const {
    beats, isLoading, loadError,
    isDegradedError, hasRollingAncestor,
  } = useBeatsQuery({
    beatsView, searchQuery, isListView, activeRepo,
    registeredRepos, shippingByBeatId,
  });

  const showRepoColumn =
    !activeRepo && registeredRepos.length > 1;
  const agentInfoByBeatId = useAgentInfoMap(
    isActiveView, beats, terminals,
  );
  const bulk = useBulkActions(beats);
  const actions = useBeatActions(
    beats, terminals,
    shippingByBeatId, hasRollingAncestor,
  );
  const detail = useBeatDetail({
    beats, detailBeatId, detailRepo, isListView,
  });

  return {
    beatsView, isListView, viewPhase,
    isActiveView, activeRepo,
    searchQuery, detailBeatId, detailRepo,
    beats, isLoading, loadError, isDegradedError,
    hasRollingAncestor, showRepoColumn,
    agentInfoByBeatId, shippingByBeatId,
    ...bulk, ...actions, ...detail,
  };
}

function BeatsPageInner() {
  const s = useBeatsPageState();
  const isFinalCutView = s.beatsView === "finalcut";
  const isRetakesView = s.beatsView === "retakes";
  const isHistoryView = s.beatsView === "history";
  const isDiagnosticsView =
    s.beatsView === "diagnostics";
  const warmupView = s.isListView
    && (s.beatsView === "queues" || s.beatsView === "active")
    ? s.beatsView
    : null;
  useBeatsScreenWarmup(
    warmupView,
    !s.isLoading && !s.loadError,
  );

  return (
    <div className={
      "mx-auto max-w-[95vw]"
      + " overflow-x-hidden px-4 pt-2"
    }>
      {s.isListView && (
        <div className={
          "mb-2 flex h-10 items-center"
          + " border-b border-border/60 pb-2"
        }>
          <FilterBar
            viewPhase={s.viewPhase}
            selectedIds={s.selectedIds}
            onBulkUpdate={s.handleBulkUpdate}
            onClearSelection={s.handleClearSelection}
            onSceneBeats={s.handleSceneBeats}
            onMergeBeats={s.handleMergeBeats}
          />
        </div>
      )}
      <BeatsViewBody
        isFinalCutView={isFinalCutView}
        isRetakesView={isRetakesView}
        isHistoryView={isHistoryView}
        isDiagnosticsView={isDiagnosticsView}
        state={s}
      />
      {s.isListView && (
        <BeatDetailLightbox
          key={`${s.detailBeatId ?? "none"}:${
            s.detailRepo ?? "none"
          }`}
          open={Boolean(s.detailBeatId)}
          beatId={s.detailBeatId}
          repo={s.detailRepo}
          initialBeat={s.initialDetailBeat}
          onOpenChange={
            s.handleBeatLightboxOpenChange
          }
          onMoved={s.handleMovedBeat}
          onShipBeat={s.handleShipBeat}
          isParentRollingBeat={
            s.hasRollingAncestor
          }
        />
      )}
      {s.isListView && (
        <MergeBeatsDialog
          open={s.mergeDialogOpen}
          onOpenChange={s.setMergeDialogOpen}
          beats={s.beats.filter(
            (b) => s.mergeBeatIds.includes(b.id),
          )}
          onMerged={s.handleClearSelection}
        />
      )}
    </div>
  );
}

type PageState = ReturnType<typeof useBeatsPageState>;

function BeatsViewBody({
  isFinalCutView, isRetakesView,
  isHistoryView,
  isDiagnosticsView,
  state: s,
}: {
  isFinalCutView: boolean;
  isRetakesView: boolean;
  isHistoryView: boolean;
  isDiagnosticsView: boolean;
  state: PageState;
}) {
  return (
    <div className="mt-0.5">
      {isFinalCutView ? (
        <FinalCutView />
      ) : isRetakesView ? (
        <RetakesView />
      ) : isHistoryView ? (
        <AgentHistoryView />
      ) : isDiagnosticsView ? (
        <DiagnosticsView
          repoPath={s.activeRepo ?? undefined}
        />
      ) : (
        <BeatsListContent
          isLoading={s.isLoading}
          loadError={s.loadError}
          isDegradedError={s.isDegradedError}
          beats={s.beats}
          showRepoColumn={s.showRepoColumn}
          isActiveView={s.isActiveView}
          agentInfoByBeatId={s.agentInfoByBeatId}
          onSelectionChange={
            s.handleSelectionChange
          }
          selectionVersion={s.selectionVersion}
          searchQuery={s.searchQuery}
          onOpenBeat={s.handleOpenBeat}
          onShipBeat={s.handleShipBeat}
          shippingByBeatId={s.shippingByBeatId}
          onAbortShipping={s.handleAbortShipping}
        />
      )}
    </div>
  );
}

interface BeatsListContentProps {
  isLoading: boolean;
  loadError: string | null;
  isDegradedError: boolean;
  beats: Beat[];
  showRepoColumn: boolean;
  isActiveView: boolean;
  agentInfoByBeatId: Record<string, AgentInfo>;
  onSelectionChange: (ids: string[]) => void;
  selectionVersion: number;
  searchQuery: string;
  onOpenBeat: (beat: Beat) => void;
  onShipBeat: (beat: Beat) => Promise<void>;
  shippingByBeatId: Record<string, string>;
  onAbortShipping: (
    beatId: string,
  ) => Promise<void>;
}

function BeatsListContent(
  props: BeatsListContentProps,
) {
  const {
    isLoading, loadError, isDegradedError,
    beats, showRepoColumn, isActiveView,
    agentInfoByBeatId, onSelectionChange,
    selectionVersion, searchQuery,
    onOpenBeat, onShipBeat,
    shippingByBeatId, onAbortShipping,
  } = props;

  if (isLoading) {
    return (
      <div className={
        "flex items-center justify-center"
        + " py-6 text-muted-foreground"
      }>
        Loading beats...
      </div>
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
  return (
    <div className="overflow-x-auto">
      {isDegradedError && (
        <DegradedBanner message={loadError} />
      )}
      <BeatTable
        data={beats}
        showRepoColumn={showRepoColumn}
        showAgentColumns={isActiveView}
        agentInfoByBeatId={agentInfoByBeatId}
        onSelectionChange={onSelectionChange}
        selectionVersion={selectionVersion}
        searchQuery={searchQuery}
        onOpenBeat={onOpenBeat}
        onShipBeat={onShipBeat}
        shippingByBeatId={shippingByBeatId}
        onAbortShipping={onAbortShipping}
      />
    </div>
  );
}

function DegradedBanner(
  { message }: { message: string | null },
) {
  return (
    <div className={
      "mb-2 flex items-center gap-2 rounded-md"
      + " border border-amber-300 bg-amber-50"
      + " px-3 py-2 text-sm text-amber-900"
      + " dark:border-amber-700"
      + " dark:bg-amber-950 dark:text-amber-200"
    }>
      <AlertTriangle
        className="size-4 shrink-0"
      />
      <span>{message}</span>
    </div>
  );
}
