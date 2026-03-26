"use client";

import { Clapperboard } from "lucide-react";
import type { Beat } from "@/lib/types";

const LABEL_COLORS = [
  "bg-red-100 text-red-800",
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-yellow-100 text-yellow-800",
  "bg-purple-100 text-purple-800",
  "bg-pink-100 text-pink-800",
  "bg-indigo-100 text-indigo-800",
  "bg-orange-100 text-orange-800",
  "bg-teal-100 text-teal-800",
  "bg-cyan-100 text-cyan-800",
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
    <div className="flex items-center gap-2">
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
            "truncate text-sm font-medium"
            + " text-left hover:underline"
          }
          onClick={() => onTitleClick(beat)}
        >
          {slug}
          {beat.title}
        </button>
      ) : (
        <span className="truncate text-sm font-medium">
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
          + " leading-none bg-slate-100 text-slate-700"
        }>
          {commitSha}
        </span>
      )}
      {isOrchestrated && (
        <span className={
          "inline-flex items-center gap-0.5 rounded"
          + " px-1 py-0 text-[10px] font-medium"
          + " leading-none bg-slate-100 text-slate-600"
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
