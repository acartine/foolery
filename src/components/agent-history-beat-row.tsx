"use client";

import type {
  AgentHistoryBeatSummary,
} from "@/lib/agent-history-types";
import { Badge } from "@/components/ui/badge";
import {
  formatTime,
  relativeTime,
  TITLE_ROW_HEIGHT_PX,
} from "./agent-history-utils";

export function BeatRow({
  beat,
  focused,
  loaded,
  onClick,
  onTab,
  onCopyId,
  title,
  displayId,
  showRepoName,
  repoName,
  buttonRef,
}: {
  beat: AgentHistoryBeatSummary;
  focused: boolean;
  loaded: boolean;
  onClick: () => void;
  onTab: () => void;
  onCopyId: () => void;
  title: string;
  displayId: string;
  showRepoName: boolean;
  repoName: string;
  buttonRef: (
    node: HTMLButtonElement | null,
  ) => void;
}) {
  const rowCls = loaded
    ? "border-l-4 border-l-cyan-500"
      + " bg-molecule-100/95 text-molecule-700"
      + " shadow-inner dark:bg-molecule-700/60"
      + " dark:text-molecule-100"
    : focused
      ? "border-l-4 border-l-sky-500"
        + " bg-lake-100/75 text-lake-700"
        + " dark:bg-lake-700/35"
        + " dark:text-lake-100"
      : "hover:bg-muted/40";

  const metaCls = loaded
    ? "text-molecule-700 dark:text-molecule-100"
    : focused
      ? "text-lake-700 dark:text-lake-100"
      : "text-muted-foreground";

  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          onTab();
        }
      }}
      tabIndex={-1}
      className={
        "relative block w-full border-b"
        + " border-border/50 px-2.5 py-1.5"
        + " text-left transition-colors "
        + rowCls
      }
      style={{
        minHeight: `${TITLE_ROW_HEIGHT_PX}px`,
      }}
    >
      <BeatRowTitle
        title={title}
        lastWorkedAt={beat.lastWorkedAt}
      />
      <BeatRowMeta
        metaCls={metaCls}
        displayId={displayId}
        onCopyId={onCopyId}
        showRepoName={showRepoName}
        repoName={repoName}
        loaded={loaded}
        lastWorkedAt={beat.lastWorkedAt}
      />
    </button>
  );
}

function BeatRowTitle({
  title,
  lastWorkedAt,
}: {
  title: string;
  lastWorkedAt: string;
}) {
  return (
    <div className={
      "flex items-start justify-between gap-2"
    }>
      <p className={
        "min-w-0 truncate text-[13px]"
        + " font-medium"
      }>
        {title}
      </p>
      <span className={
        "shrink-0 text-[11px]"
        + " text-muted-foreground"
      }>
        {relativeTime(lastWorkedAt)}
      </span>
    </div>
  );
}

function BeatRowMeta({
  metaCls,
  displayId,
  onCopyId,
  showRepoName,
  repoName,
  loaded,
  lastWorkedAt,
}: {
  metaCls: string;
  displayId: string;
  onCopyId: () => void;
  showRepoName: boolean;
  repoName: string;
  loaded: boolean;
  lastWorkedAt: string;
}) {
  return (
    <div className={
      "mt-0.5 flex flex-wrap items-center"
      + " gap-1 text-[10px] "
      + metaCls
    }>
      <span
        role="button"
        tabIndex={-1}
        className={
          "cursor-pointer font-mono"
          + " underline-offset-2"
          + " hover:underline"
        }
        onClick={(e) => {
          e.stopPropagation();
          onCopyId();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Click to copy ID"
      >
        {displayId}
      </span>
      {showRepoName ? (
        <Badge
          variant="outline"
          className="text-[10px] font-normal"
        >
          {repoName}
        </Badge>
      ) : null}
      {loaded ? (
        <Badge
          variant="outline"
          className={
            "border-molecule-400/60"
            + " text-[10px] font-normal"
          }
        >
          loaded
        </Badge>
      ) : null}
      <span>
        Last updated{" "}
        {formatTime(lastWorkedAt)}
      </span>
    </div>
  );
}
