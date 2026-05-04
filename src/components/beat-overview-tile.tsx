import type { Beat } from "@/lib/types";
import type {
  OverviewLeaseInfo,
} from "@/lib/beat-state-overview";
import {
  overviewBeatLabel,
  overviewLeaseInfoForBeat,
} from "@/lib/beat-state-overview";
import { displayBeatLabel } from "@/lib/beat-display";
import { BeatPriorityBadge } from "@/components/beat-priority-badge";
import { BeatTypeBadge } from "@/components/beat-type-badge";
import { relativeTime } from "@/components/beat-column-time";

export function BeatOverviewTile({
  beat,
  showRepoColumn,
  isAllRepositories,
  leaseInfo,
  onOpenBeat,
}: {
  beat: Beat;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfo: OverviewLeaseInfo | null;
  onOpenBeat: (beat: Beat) => void;
}) {
  const repoLabel = showRepoColumn
    ? repoDisplayName(beat)
    : null;
  const contextItems = overviewContextItems(beat, repoLabel);

  return (
    <button
      type="button"
      className={
        "block w-full px-2 py-1.5 text-left"
        + " transition-colors hover:bg-muted/35"
        + " focus-visible:outline-none"
        + " focus-visible:ring-2 focus-visible:ring-ring"
      }
      data-testid="beat-overview-tile"
      title={beat.title}
      onClick={() => onOpenBeat(beat)}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={
          "min-w-0 truncate font-mono text-[9px]"
          + " leading-3 text-muted-foreground"
        }>
          {overviewBeatLabel(beat, isAllRepositories)}
        </span>
        <BeatPriorityBadge
          priority={beat.priority}
          className="h-3.5 rounded-sm px-1 text-[9px]"
        />
      </div>
      <div className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug">
        {beat.title}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
        <BeatTypeBadge
          type={beat.type}
          className={
            "h-3.5 max-w-[8.5rem] rounded-sm px-1"
            + " text-[9px] [&>svg]:size-2"
          }
        />
        <span className="text-[9px] leading-3 text-muted-foreground">
          {relativeTime(beat.updated)}
        </span>
      </div>
      {contextItems.length > 0 && (
        <div className={
          "mt-0.5 flex min-w-0 flex-wrap gap-x-1.5"
          + " gap-y-0.5 text-[9px] leading-3 text-muted-foreground"
        }>
          {contextItems.map((item) => (
            <span
              key={item}
              className="max-w-full truncate"
            >
              {item}
            </span>
          ))}
        </div>
      )}
      {leaseInfo && (
        <LeaseInfoLine info={leaseInfo} />
      )}
    </button>
  );
}

export function leaseInfoForOverviewTile(
  beat: Beat,
  leaseInfoByBeatKey: Record<string, OverviewLeaseInfo>,
): OverviewLeaseInfo | null {
  const byTile = leaseInfoByBeatKey[overviewTileKey(beat)];
  const byId = leaseInfoByBeatKey[beat.id];
  return overviewLeaseInfoForBeat(beat, byTile ?? byId);
}

export function overviewTileKey(
  beat: Beat,
): string {
  const record = beat as Beat & { _repoPath?: unknown };
  return typeof record._repoPath === "string"
    ? `${record._repoPath}:${beat.id}`
    : beat.id;
}

function LeaseInfoLine({ info }: { info: OverviewLeaseInfo }) {
  const parts = [
    info.startedAt ? `Lease ${relativeTime(info.startedAt)}` : null,
    info.provider,
    info.model,
    info.version,
  ].filter(Boolean);

  if (parts.length === 0) return null;

  return (
    <div
      className={
        "mt-0.5 flex min-w-0 flex-wrap gap-x-1.5"
        + " gap-y-0.5 text-[9px] leading-3 text-ochre-700"
        + " dark:text-ochre-100"
      }
      data-testid="beat-overview-lease-info"
    >
      {parts.map((part) => (
        <span
          key={part}
          className="max-w-full truncate"
        >
          {part}
        </span>
      ))}
    </div>
  );
}

function repoDisplayName(
  beat: Beat,
): string | null {
  const record = beat as Beat & {
    _repoName?: unknown;
    _repoPath?: unknown;
  };
  if (
    typeof record._repoName === "string"
    && record._repoName.trim().length > 0
  ) {
    return record._repoName.trim();
  }
  if (
    typeof record._repoPath === "string"
    && record._repoPath.trim().length > 0
  ) {
    const path = record._repoPath.trim();
    return path.split("/").filter(Boolean).pop() ?? path;
  }
  return null;
}

function overviewContextItems(
  beat: Beat,
  repoLabel: string | null,
): string[] {
  const items: string[] = [];
  if (beat.parent) {
    items.push(`Parent ${displayBeatLabel(beat.parent)}`);
  }
  if (repoLabel) {
    items.push(repoLabel);
  }
  return items;
}
