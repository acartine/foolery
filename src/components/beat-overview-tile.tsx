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
  onFocusLeaseSession,
  onReleaseBeat,
}: {
  beat: Beat;
  showRepoColumn: boolean;
  isAllRepositories: boolean;
  leaseInfo: OverviewLeaseInfo | null;
  onOpenBeat: (beat: Beat) => void;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
}) {
  const repoLabel = showRepoColumn
    ? repoDisplayName(beat)
    : null;
  const contextItems = overviewContextItems(beat, repoLabel);

  return (
    <div
      className={
        "w-full"
        + " transition-colors hover:bg-muted/35"
        + " focus-within:ring-2 focus-within:ring-ring"
      }
      data-testid="beat-overview-tile"
      title={beat.title}
    >
      <button
        type="button"
        className={
          "block w-full px-2 pt-1.5 text-left"
          + (leaseInfo ? " pb-0.5" : " pb-1.5")
          + " focus-visible:outline-none"
        }
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
      </button>
      {leaseInfo && (
        <LeaseInfoBlock
          beat={beat}
          info={leaseInfo}
          onFocusLeaseSession={onFocusLeaseSession}
          onReleaseBeat={onReleaseBeat}
        />
      )}
    </div>
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

function LeaseInfoBlock({
  beat,
  info,
  onFocusLeaseSession,
  onReleaseBeat,
}: {
  beat: Beat;
  info: OverviewLeaseInfo;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
}) {
  const providerAgent = providerAgentLabel(info);
  const fields = [
    { label: "Provider/agent", value: providerAgent ?? "-" },
    { label: "Model", value: info.model ?? "-" },
    { label: "Version", value: info.version ?? "-" },
  ];

  return (
    <div
      className={
        "px-2 pb-1.5 text-[8px] leading-[1.15]"
        + " text-ochre-700 dark:text-ochre-100"
      }
      data-testid="beat-overview-lease-info"
    >
      {info.startedAt && (
        <div className="truncate text-[9px] leading-3">
          Lease {relativeTime(info.startedAt)}
        </div>
      )}
      <div className="mt-0.5 space-y-px">
        {fields.map((field) => (
          <LeaseInfoField
            key={field.label}
            label={field.label}
            value={field.value}
          />
        ))}
      </div>
      <LeaseAction
        beat={beat}
        sessionId={info.sessionId}
        onFocusLeaseSession={onFocusLeaseSession}
        onReleaseBeat={onReleaseBeat}
      />
    </div>
  );
}

function LeaseInfoField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1">
      <span className="min-w-0 uppercase text-ochre-600 dark:text-ochre-200">
        {label}
      </span>
      <span
        className="min-w-0 truncate text-foreground/80"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function LeaseAction({
  beat,
  sessionId,
  onFocusLeaseSession,
  onReleaseBeat,
}: {
  beat: Beat;
  sessionId?: string;
  onFocusLeaseSession: (sessionId: string) => void;
  onReleaseBeat: (beat: Beat) => void;
}) {
  const label = sessionId ? "Focus session" : "Release";
  const onClick = sessionId
    ? () => onFocusLeaseSession(sessionId)
    : () => onReleaseBeat(beat);

  return (
    <button
      type="button"
      className={
        "mt-0.5 text-[9px] font-medium leading-3"
        + " text-ochre-800 underline-offset-2 hover:underline"
        + " focus-visible:outline-none focus-visible:ring-1"
        + " focus-visible:ring-ring dark:text-ochre-100"
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function providerAgentLabel(
  info: OverviewLeaseInfo,
): string | undefined {
  const provider = info.provider?.trim();
  const agent = info.agent?.trim();
  if (!provider) return agent || undefined;
  if (!agent) return provider;
  if (provider.toLowerCase() === agent.toLowerCase()) return provider;
  return `${provider} / ${agent}`;
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
