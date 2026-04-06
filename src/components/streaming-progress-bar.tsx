"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamingProgress } from
  "@/app/beats/use-streaming-progress";

const FADE_DELAY_MS = 1500;
const FADE_DURATION_MS = 200;

interface StreamingProgressBarProps {
  progress: StreamingProgress;
}

/**
 * Thin progress bar + status text shown during
 * multi-repo streaming. Fades out after completion.
 *
 * Visibility is derived from props + a "dismissed"
 * flag set after a post-completion timer.
 */
export function StreamingProgressBar({
  progress,
}: StreamingProgressBarProps) {
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Reset dismissed flag when streaming restarts.
  if (progress.isStreaming && dismissed) {
    setDismissed(false);
  }

  useEffect(() => {
    if (!progress.isComplete) return;
    timerRef.current = setTimeout(() => {
      setDismissed(true);
    }, FADE_DELAY_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [progress.isComplete]);

  const showBar =
    progress.isStreaming || progress.isComplete;
  if (!showBar || dismissed) return null;

  const pct = progress.totalRepos > 0
    ? Math.round(
      (progress.loadedRepos.length
        / progress.totalRepos) * 100,
    )
    : 0;

  const label = !progress.isStreaming && progress.isComplete
    ? "All repositories loaded"
    : progress.loadedBeatsCount > 0
      ? `Loading\u2026 ${progress.loadedBeatsCount} beats`
        + ` from ${progress.loadedRepos.length}`
        + `/${progress.totalRepos} repos`
      : `Loading ${progress.totalRepos} repositories\u2026`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="streaming-progress-bar"
      className={
        "mb-1 transition-opacity"
        + " motion-reduce:transition-none"
        + " opacity-100"
      }
      style={{
        transitionDuration: `${FADE_DURATION_MS}ms`,
      }}
    >
      <div className={
        "flex items-center gap-2"
        + " text-xs text-muted-foreground"
      }>
        <div className={
          "relative h-1 flex-1 overflow-hidden"
          + " rounded-full bg-muted"
        }>
          <div
            data-testid="streaming-progress-fill"
            className={
              "absolute inset-y-0 left-0"
              + " rounded-full bg-primary"
              + " transition-[width]"
              + " duration-200"
              + " motion-reduce:transition-none"
            }
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0">{label}</span>
      </div>
    </div>
  );
}
