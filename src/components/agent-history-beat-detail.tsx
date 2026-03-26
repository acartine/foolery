"use client";

import type {
  AgentHistoryBeatSummary,
} from "@/lib/agent-history-types";
import type { Beat } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { displayBeatLabel } from "@/lib/beat-display";
import { BeatMetadataDetails } from "@/components/beat-metadata-details";
import {
  formatTime,
  relativeTime,
} from "./agent-history-utils";

function BeatMetaItem(
  { label, value }: {
    label: string;
    value?: string | null;
  },
) {
  return (
    <div className="px-0.5 py-0.5">
      <p className={
        "text-[11px] uppercase tracking-wide"
        + " text-muted-foreground"
      }>
        {label}
      </p>
      <p className="mt-0.5 break-words text-[12px]">
        {value?.trim() || "\u2014"}
      </p>
    </div>
  );
}

function renderLongText(
  label: string,
  value?: string,
) {
  if (!value?.trim()) return null;
  return (
    <section className="px-0.5 py-0.5">
      <p className={
        "text-[11px] uppercase tracking-wide"
        + " text-muted-foreground"
      }>
        {label}
      </p>
      <pre className={
        "mt-1 whitespace-pre-wrap break-words"
        + " font-mono text-[12px] leading-5"
        + " text-foreground"
      }>
        {value}
      </pre>
    </section>
  );
}

export function BeatDetailContent({
  beat,
  summary,
  showExpandedDetails,
  onCopyBeatId,
}: {
  beat: Beat | null;
  summary: AgentHistoryBeatSummary;
  showExpandedDetails: boolean;
  onCopyBeatId: (beatId: string) => void;
}) {
  if (!beat) {
    return (
      <div className={
        "px-0.5 py-2 text-center text-[11px]"
        + " text-muted-foreground"
      }>
        Beat details are unavailable for this
        repository entry.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <BeatMetaGrid
        beat={beat}
        summary={summary}
        onCopyBeatId={onCopyBeatId}
      />
      <BeatLabels labels={beat.labels} />
      <BeatMetadataDetails
        beat={beat}
        showExpandedDetails={showExpandedDetails}
        formatRelativeTime={relativeTime}
      />
      {renderLongText(
        "Acceptance",
        beat.acceptance,
      )}
    </div>
  );
}

function BeatMetaGrid({
  beat,
  summary,
  onCopyBeatId,
}: {
  beat: Beat;
  summary: AgentHistoryBeatSummary;
  onCopyBeatId: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <div className="px-0.5 py-0.5">
        <p className={
          "text-[10px] uppercase tracking-wide"
          + " text-muted-foreground"
        }>
          Beat
        </p>
        <button
          type="button"
          className={
            "mt-0.5 break-words text-left"
            + " font-mono text-[11px]"
            + " underline-offset-2"
            + " hover:underline"
          }
          onClick={() => onCopyBeatId(beat.id)}
          title="Click to copy ID"
        >
          {displayBeatLabel(beat.id, beat.aliases)}
        </button>
      </div>
      <BeatMetaItem
        label="Last updated"
        value={formatTime(summary.lastWorkedAt)}
      />
      <BeatMetaItem
        label="State"
        value={beat.state}
      />
      <BeatMetaItem
        label="Type"
        value={beat.type}
      />
      <BeatMetaItem
        label="Priority"
        value={`P${beat.priority}`}
      />
      <BeatMetaItem
        label="Owner"
        value={beat.owner ?? beat.assignee ?? ""}
      />
      <BeatMetaItem
        label="Created"
        value={formatTime(beat.created)}
      />
      <BeatMetaItem
        label="Updated"
        value={formatTime(beat.updated)}
      />
    </div>
  );
}

function BeatLabels(
  { labels }: { labels?: string[] },
) {
  if (!labels || labels.length === 0) return null;
  return (
    <section className="px-0.5 py-0.5">
      <p className={
        "text-[10px] uppercase tracking-wide"
        + " text-muted-foreground"
      }>
        Labels
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {labels.map((label) => (
          <Badge
            key={label}
            variant="outline"
            className="text-[11px] font-normal"
          >
            {label}
          </Badge>
        ))}
      </div>
    </section>
  );
}
