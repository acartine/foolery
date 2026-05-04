"use client";

import { overviewBeatLabel } from "@/lib/beat-state-overview";
import {
  STALE_GROOMING_DECISION_LABELS,
} from "@/lib/stale-beat-grooming-types";
import type {
  StaleBeatGroomingReviewRecord,
  StaleBeatSummary,
} from "@/lib/stale-beat-grooming-types";
import type { Beat } from "@/lib/types";

export function StaleBeatDialogList({
  staleBeats,
  selectedKeys,
  reviewsByKey,
  isAllRepositories,
  onToggle,
  onOpenBeat,
}: {
  staleBeats: StaleBeatSummary[];
  selectedKeys: ReadonlySet<string>;
  reviewsByKey: Map<string, StaleBeatGroomingReviewRecord>;
  isAllRepositories: boolean;
  onToggle: (key: string) => void;
  onOpenBeat: (beat: Beat) => void;
}) {
  if (staleBeats.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No stale beats
      </div>
    );
  }
  return (
    <div className="min-h-0 overflow-y-auto divide-y divide-border/70">
      {staleBeats.map((summary) => (
        <StaleBeatDialogRow
          key={summary.key}
          summary={summary}
          selected={selectedKeys.has(summary.key)}
          review={reviewsByKey.get(summary.key)}
          isAllRepositories={isAllRepositories}
          onToggle={() => onToggle(summary.key)}
          onOpenBeat={() => onOpenBeat(summary.beat)}
        />
      ))}
    </div>
  );
}

function StaleBeatDialogRow({
  summary,
  selected,
  review,
  isAllRepositories,
  onToggle,
  onOpenBeat,
}: {
  summary: StaleBeatSummary;
  selected: boolean;
  review: StaleBeatGroomingReviewRecord | undefined;
  isAllRepositories: boolean;
  onToggle: () => void;
  onOpenBeat: () => void;
}) {
  const label = overviewBeatLabel(summary.beat, isAllRepositories);
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_72px] gap-2 py-2">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${label}`}
        className="mt-1 size-4"
      />
      <button type="button" onClick={onOpenBeat} className="min-w-0 text-left">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">
            {label}
          </span>
          <span className="min-w-0 text-sm font-medium">
            {summary.title}
          </span>
        </div>
        {review && <ReviewStatusLine review={review} />}
      </button>
      <span className="text-right text-xs text-muted-foreground">
        {summary.ageDays}d
      </span>
    </div>
  );
}

function ReviewStatusLine({
  review,
}: {
  review: StaleBeatGroomingReviewRecord;
}) {
  const decision = review.result?.decision;
  const label = decision
    ? STALE_GROOMING_DECISION_LABELS[decision]
    : review.status;
  return (
    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
      {label}
      {review.error ? `: ${review.error}` : ""}
      {review.result?.rationale ? `: ${review.result.rationale}` : ""}
    </div>
  );
}
