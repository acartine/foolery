"use client";

import {
  ChevronRight,
  FileText,
} from "lucide-react";
import type {
  AgentHistoryBeatSummary,
} from "@/lib/agent-history-types";
import type { Beat } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { displayBeatLabel } from "@/lib/beat-display";
import { cn } from "@/lib/utils";
import {
  formatTime,
  Spinner,
  TITLE_ROW_HEIGHT_PX,
  TOP_PANEL_HEADER_HEIGHT_PX,
  TOP_PANEL_HEIGHT_PX,
  WINDOW_SIZE,
} from "./agent-history-utils";
import {
  BeatDetailContent,
} from "./agent-history-beat-detail";

export interface DetailPanelProps {
  focusedSummary: AgentHistoryBeatSummary | null;
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
  copyBeatId: (id: string) => void;
}

export function BeatDetailPanel(
  props: DetailPanelProps,
) {
  return (
    <section
      className={
        "rounded-lg border"
        + " border-slate-300/80 bg-slate-50/80"
        + " shadow-sm dark:border-slate-700"
        + " dark:bg-slate-900/30"
      }
      style={{
        height: `${TOP_PANEL_HEIGHT_PX}px`,
      }}
    >
      <BeatDetailHeader {...props} />
      <div
        className="overflow-y-auto p-2"
        style={{
          height: `${
            WINDOW_SIZE * TITLE_ROW_HEIGHT_PX
          }px`,
        }}
      >
        <BeatDetailBody
          focusedSummary={props.focusedSummary}
          focusedDetail={props.focusedDetail}
          showExpandedDetails={
            props.showExpandedDetails
          }
          copyBeatId={props.copyBeatId}
        />
      </div>
    </section>
  );
}

function BeatDetailHeader({
  focusedSummary,
  focusedDetail,
  focusedTitle,
  showExpandedDetails,
  setShowExpandedDetails,
  copyBeatId,
}: DetailPanelProps) {
  return (
    <div
      className={
        "flex items-center gap-1.5 border-b"
        + " border-border/60 px-2.5 py-1.5"
      }
      style={{
        height: `${TOP_PANEL_HEADER_HEIGHT_PX}px`,
      }}
    >
      <FileText className={
        "size-3.5 text-muted-foreground"
      } />
      <DetailHeaderTitle
        focusedSummary={focusedSummary}
        focusedTitle={focusedTitle}
      />
      {focusedSummary ? (
        <DetailHeaderActions
          focusedSummary={focusedSummary}
          focusedDetail={focusedDetail}
          showExpandedDetails={
            showExpandedDetails
          }
          setShowExpandedDetails={
            setShowExpandedDetails
          }
          copyBeatId={copyBeatId}
        />
      ) : null}
    </div>
  );
}

function DetailHeaderTitle({
  focusedSummary,
  focusedTitle,
}: {
  focusedSummary: AgentHistoryBeatSummary | null;
  focusedTitle: string;
}) {
  return (
    <div className="min-w-0">
      <p className={
        "truncate text-[13px] font-semibold"
      }>
        {focusedTitle}
      </p>
      <p className={
        "truncate text-[10px]"
        + " text-muted-foreground"
      }>
        {focusedSummary
          ? "Last updated "
            + formatTime(
              focusedSummary.lastWorkedAt,
            )
          : "Select a beat from the left"}
      </p>
    </div>
  );
}

function DetailHeaderActions({
  focusedSummary,
  focusedDetail,
  showExpandedDetails,
  setShowExpandedDetails,
  copyBeatId,
}: {
  focusedSummary: AgentHistoryBeatSummary;
  focusedDetail: { beat: Beat | null };
  showExpandedDetails: boolean;
  setShowExpandedDetails: (
    fn: (prev: boolean) => boolean,
  ) => void;
  copyBeatId: (id: string) => void;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={
          "ml-auto h-6 gap-1 px-2 text-[11px]"
        }
        aria-expanded={showExpandedDetails}
        aria-label={showExpandedDetails ? "Collapse details" : "Expand details"}
        title={showExpandedDetails ? "Collapse details" : "Expand details"}
        onClick={() => { setShowExpandedDetails((prev) => !prev); }}
      >
        <ChevronRight className={cn(
          "size-3.5 transition-transform",
          showExpandedDetails && "rotate-90",
        )} />
        <span>
          {showExpandedDetails
            ? "Hide extras"
            : "Show extras"}
        </span>
      </Button>
      <button
        type="button"
        className={
          "font-mono text-[11px]"
          + " text-muted-foreground"
          + " underline-offset-2"
          + " hover:underline"
        }
        onClick={() => {
          copyBeatId(focusedSummary.beatId);
        }}
        title="Click to copy ID"
      >
        {displayBeatLabel(focusedSummary.beatId, focusedDetail.beat?.aliases)}
      </button>
    </>
  );
}

function BeatDetailBody({
  focusedSummary,
  focusedDetail,
  showExpandedDetails,
  copyBeatId,
}: {
  focusedSummary: AgentHistoryBeatSummary | null;
  focusedDetail: {
    loading: boolean;
    error: string | null;
    beat: Beat | null;
  };
  showExpandedDetails: boolean;
  copyBeatId: (id: string) => void;
}) {
  if (!focusedSummary) {
    return (
      <div className={
        "px-0.5 py-2 text-center text-[11px]"
        + " text-muted-foreground"
      }>
        Select a beat to inspect details.
      </div>
    );
  }
  if (focusedDetail.loading) {
    return (
      <div className={
        "flex items-center justify-center"
        + " gap-1.5 px-0.5 py-2 text-[11px]"
        + " text-muted-foreground"
      }>
        <Spinner className="size-3" />
        <span>Loading beat details…</span>
      </div>
    );
  }
  if (focusedDetail.error) {
    return (
      <div className={
        "px-0.5 py-2 text-center text-[11px]"
        + " text-destructive"
      }>
        {focusedDetail.error}
      </div>
    );
  }
  return (
    <BeatDetailContent
      beat={focusedDetail.beat}
      summary={focusedSummary}
      showExpandedDetails={showExpandedDetails}
      onCopyBeatId={copyBeatId}
    />
  );
}
