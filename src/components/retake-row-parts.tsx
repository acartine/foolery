"use client";

import { Clapperboard } from "lucide-react";
import type { Beat } from "@/lib/types";

const LABEL_COLORS = [
  "bg-rust-100 text-rust-700",
  "bg-lake-100 text-lake-700",
  "bg-moss-100 text-moss-700",
  "bg-ochre-100 text-ochre-700",
  "bg-clay-100 text-clay-800",
  "bg-rust-100 text-rust-700",
  "bg-gate-100 text-gate-700",
  "bg-ochre-100 text-ochre-700",
  "bg-mr-100 text-mr-700",
  "bg-molecule-100 text-molecule-700",
];

export function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (
      (hash << 5) - hash + label.charCodeAt(i)
    ) | 0;
  }
  return LABEL_COLORS[
    Math.abs(hash) % LABEL_COLORS.length
  ];
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function RetakeRowTitle({
  beat,
  qualifiedId,
  waveSlug,
  onTitleClick,
}: {
  beat: Beat;
  qualifiedId: string;
  waveSlug: string | undefined;
  onTitleClick?: (beat: Beat) => void;
}) {
  const slug = waveSlug && (
    <span className={
      "text-xs font-mono text-muted-foreground mr-1"
    }>
      [{waveSlug}]
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={
        "shrink-0 font-mono text-[11px]"
        + " text-muted-foreground"
      }>
        {qualifiedId}
      </span>
      {onTitleClick ? (
        <button
          type="button"
          title="Open beat details"
          className={
            "min-w-0 flex-1 truncate text-sm font-medium"
            + " text-left hover:underline"
          }
          onClick={() => onTitleClick(beat)}
        >
          {slug}
          {beat.title}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {slug}
          {beat.title}
        </span>
      )}
    </div>
  );
}

export function RetakeRowLabels({
  beat,
  commitSha,
  isOrchestrated,
  visibleLabels,
}: {
  beat: Beat;
  commitSha: string | undefined;
  isOrchestrated: boolean;
  visibleLabels: string[];
}) {
  return (
    <div className={
      "mt-1 flex items-center gap-1.5 flex-wrap"
    }>
      <span className="text-[11px] text-muted-foreground">
        {relativeTime(beat.updated)}
      </span>
      {commitSha && (
        <span className={
          "inline-flex items-center rounded px-1 py-0"
          + " text-[10px] font-mono font-medium"
          + " leading-none bg-paper-100 text-ink-700"
        }>
          {commitSha}
        </span>
      )}
      {isOrchestrated && (
        <span className={
          "inline-flex items-center gap-0.5 rounded"
          + " px-1 py-0 text-[10px] font-medium"
          + " leading-none bg-paper-100 text-ink-600"
        }>
          <Clapperboard className="size-2.5" />
          Orchestrated
        </span>
      )}
      {visibleLabels.map((label) => (
        <span
          key={label}
          className={
            "inline-flex items-center rounded px-1 py-0"
            + " text-[10px] font-medium leading-none "
            + labelColor(label)
          }
        >
          {label}
        </span>
      ))}
    </div>
  );
}
