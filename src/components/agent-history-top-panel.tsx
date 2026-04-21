"use client";

import type { MutableRefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
} from "lucide-react";
import type {
  AgentHistoryBeatSummary,
  AgentHistoryPayload,
} from "@/lib/agent-history-types";
import type { Beat, BdResult } from "@/lib/types";
import { displayBeatLabel } from "@/lib/beat-display";
import type {
  UseQueryResult,
} from "@tanstack/react-query";
import {
  beatKey,
  Spinner,
  TITLE_ROW_HEIGHT_PX,
  TOP_PANEL_HEADER_HEIGHT_PX,
  TOP_PANEL_HEIGHT_PX,
  WINDOW_SIZE,
} from "./agent-history-utils";
import { BeatRow } from "./agent-history-beat-row";
import {
  BeatDetailPanel,
} from "./agent-history-detail-panel";

export interface TopPanelProps {
  beats: AgentHistoryBeatSummary[];
  visibleBeats: AgentHistoryBeatSummary[];
  windowStart: number;
  focusedBeatKey: string | null;
  loadedBeatKey: string | null;
  setFocusedBeatKey: (
    k: string | null,
  ) => void;
  setLoadedBeatKey: (
    k: string | null,
  ) => void;
  moveFocusedBeat: (d: -1 | 1) => void;
  focusBeatList: () => void;
  focusConsolePanel: () => void;
  copyBeatId: (id: string) => void;
  getBeatTitle: (
    s: AgentHistoryBeatSummary | null,
  ) => string;
  beatButtonRefs: MutableRefObject<
    Record<string, HTMLButtonElement | null>
  >;
  beatListRef: MutableRefObject<
    HTMLDivElement | null
  >;
  beatsQuery: UseQueryResult<
    BdResult<AgentHistoryPayload>,
    Error
  >;
  beatDetailMap: Map<string, Beat>;
  focusedSummary:
    AgentHistoryBeatSummary | null;
  focusedDetail: {
    loading: boolean;
    error: string | null;
    beat: Beat | null;
  };
  focusedTitle: string;
  showExpandedDetails: boolean;
  setShowExpandedDetails: (
    fn: (prev: boolean) => boolean,
  ) => void;
  showRepoName: boolean;
  repoNames: Map<string, string>;
}

export function AgentHistoryTopPanel(
  p: TopPanelProps,
) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <BeatListPanel {...p} />
      <BeatDetailPanel
        focusedSummary={p.focusedSummary}
        focusedDetail={p.focusedDetail}
        focusedTitle={p.focusedTitle}
        showExpandedDetails={
          p.showExpandedDetails
        }
        setShowExpandedDetails={
          p.setShowExpandedDetails
        }
        copyBeatId={p.copyBeatId}
      />
    </div>
  );
}

function BeatListPanel({
  beats,
  visibleBeats,
  windowStart,
  focusedBeatKey,
  loadedBeatKey,
  setFocusedBeatKey,
  setLoadedBeatKey,
  moveFocusedBeat,
  focusBeatList,
  focusConsolePanel,
  copyBeatId,
  getBeatTitle,
  beatButtonRefs,
  beatListRef,
  beatsQuery,
  beatDetailMap,
  showRepoName,
  repoNames,
}: TopPanelProps) {
  return (
    <aside
      className={
        "rounded-lg border"
        + " border-paper-300/80"
        + " bg-paper-50/80 shadow-sm"
        + " dark:border-walnut-200"
        + " dark:bg-walnut-400/30"
      }
      style={{
        height: `${TOP_PANEL_HEIGHT_PX}px`,
      }}
    >
      <BeatListHeader
        beats={beats}
        windowStart={windowStart}
      />
      <div
        ref={beatListRef}
        tabIndex={0}
        onKeyDown={(event) => {
          handleBeatListKeyDown(event, {
            focusedBeatKey,
            setLoadedBeatKey,
            moveFocusedBeat,
            focusConsolePanel,
          });
        }}
        style={{
          height: `${
            WINDOW_SIZE * TITLE_ROW_HEIGHT_PX
          }px`,
        }}
        className={
          "overflow-y-auto outline-none"
          + " focus-visible:ring-1"
          + " focus-visible:ring-sky-500/70"
        }
      >
        <BeatListContent
          beats={beats}
          visibleBeats={visibleBeats}
          focusedBeatKey={focusedBeatKey}
          loadedBeatKey={loadedBeatKey}
          setFocusedBeatKey={
            setFocusedBeatKey
          }
          setLoadedBeatKey={setLoadedBeatKey}
          focusBeatList={focusBeatList}
          focusConsolePanel={
            focusConsolePanel
          }
          copyBeatId={copyBeatId}
          getBeatTitle={getBeatTitle}
          beatButtonRefs={beatButtonRefs}
          beatsQuery={beatsQuery}
          beatDetailMap={beatDetailMap}
          showRepoName={showRepoName}
          repoNames={repoNames}
        />
      </div>
    </aside>
  );
}

function BeatListHeader({
  beats,
  windowStart,
}: {
  beats: AgentHistoryBeatSummary[];
  windowStart: number;
}) {
  const endIdx = Math.min(
    windowStart + WINDOW_SIZE,
    beats.length,
  );
  const totalSessions = beats.reduce(
    (sum, b) => sum + b.sessionCount,
    0,
  );
  return (
    <div
      className={
        "border-b border-border/60"
        + " px-2.5 py-1.5"
      }
      style={{
        height: `${
          TOP_PANEL_HEADER_HEIGHT_PX
        }px`,
      }}
    >
      <p className="text-[13px] font-semibold">
        Beats with Agent Sessions
      </p>
      <p className={
        "text-[11px] text-muted-foreground"
      }>
        {beats.length > 0
          ? `Showing ${windowStart + 1}`
            + `\u2013${endIdx}`
            + ` of ${beats.length} beats`
            + ` (${totalSessions}`
            + " total sessions),"
            + " newest first."
          : "Newest first."}
      </p>
      <KeyboardHints />
    </div>
  );
}

function KeyboardHints() {
  return (
    <div className={
      "mt-1 inline-flex items-center"
      + " gap-2 text-[10px]"
      + " text-muted-foreground"
    }>
      <span className={
        "inline-flex items-center gap-1"
      }>
        <ArrowUp className="size-3" />/
        <ArrowDown className="size-3" />{" "}
        navigate
      </span>
      <span className={
        "inline-flex items-center gap-1"
      }>
        <CornerDownLeft className="size-3" />/
        <span className={
          "text-[9px] font-semibold"
        }>
          Space
        </span>{" "}
        load logs
      </span>
      <span className={
        "inline-flex items-center gap-1"
      }>
        <span className={
          "text-[9px] font-semibold"
        }>
          Tab
        </span>{" "}
        console focus
      </span>
    </div>
  );
}

function handleBeatListKeyDown(
  event: React.KeyboardEvent,
  ctx: Pick<
    TopPanelProps,
    | "focusedBeatKey"
    | "setLoadedBeatKey"
    | "moveFocusedBeat"
    | "focusConsolePanel"
  >,
) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    ctx.moveFocusedBeat(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    ctx.moveFocusedBeat(-1);
    return;
  }
  if (
    event.key === "Enter"
    && ctx.focusedBeatKey
  ) {
    event.preventDefault();
    ctx.setLoadedBeatKey(ctx.focusedBeatKey);
    ctx.focusConsolePanel();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    ctx.focusConsolePanel();
  }
  if (event.key === " ") {
    event.preventDefault();
    if (ctx.focusedBeatKey) {
      ctx.setLoadedBeatKey(
        ctx.focusedBeatKey,
      );
    }
  }
}

interface BeatListContentProps {
  beats: AgentHistoryBeatSummary[];
  visibleBeats: AgentHistoryBeatSummary[];
  focusedBeatKey: string | null;
  loadedBeatKey: string | null;
  setFocusedBeatKey: (
    k: string | null,
  ) => void;
  setLoadedBeatKey: (
    k: string | null,
  ) => void;
  focusBeatList: () => void;
  focusConsolePanel: () => void;
  copyBeatId: (id: string) => void;
  getBeatTitle: (
    s: AgentHistoryBeatSummary | null,
  ) => string;
  beatButtonRefs: TopPanelProps["beatButtonRefs"];
  beatsQuery: TopPanelProps["beatsQuery"];
  beatDetailMap: Map<string, Beat>;
  showRepoName: boolean;
  repoNames: Map<string, string>;
}

function BeatListContent(
  q: BeatListContentProps,
) {
  if (q.beatsQuery.isLoading) {
    return (
      <div className={
        "flex items-center gap-2"
        + " px-2.5 py-3 text-[13px]"
        + " text-muted-foreground"
      }>
        <Spinner className="size-3.5" />
        <span>
          Loading history… prompt histories
          are BIG, please be patient :-)
        </span>
      </div>
    );
  }
  if (
    q.beatsQuery.data
    && !q.beatsQuery.data.ok
  ) {
    return (
      <div className={
        "px-2.5 py-3 text-[13px]"
        + " text-destructive"
      }>
        {q.beatsQuery.data.error
          ?? "Failed to load history"}
      </div>
    );
  }
  if (q.beats.length === 0) {
    return (
      <div className={
        "px-2.5 py-3 text-[13px]"
        + " text-muted-foreground"
      }>
        No beats with conversation activity.
      </div>
    );
  }
  return (
    <>
      {q.visibleBeats.map((beat) => {
        const key = beatKey(beat.beatId, beat.repoPath);
        const { beatDetailMap } = q;
        const displayId = displayBeatLabel(beat.beatId, beatDetailMap.get(key)?.aliases);
        return (
          <BeatRow
            key={key}
            beat={beat}
            focused={q.focusedBeatKey === key}
            loaded={q.loadedBeatKey === key}
            onClick={() => {
              q.setFocusedBeatKey(key);
              q.setLoadedBeatKey(key);
              q.focusBeatList();
            }}
            onTab={() => {
              q.focusConsolePanel();
            }}
            onCopyId={() => {
              q.copyBeatId(beat.beatId);
            }}
            title={q.getBeatTitle(beat)}
            displayId={displayId}
            showRepoName={q.showRepoName}
            repoName={q.repoNames.get(beat.repoPath) ?? beat.repoPath}
            buttonRef={(node) => {
              q.beatButtonRefs.current[key] = node;
            }}
          />
        );
      })}
    </>
  );
}
