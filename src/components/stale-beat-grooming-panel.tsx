"use client";

import {
  useMemo,
  useState,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentDisplayLabel } from "@/components/agent-display-label";
import {
  buildStaleBeatReviewRequest,
  getStaleBeatSummaries,
} from "@/lib/stale-beat-grooming";
import {
  fetchStaleBeatGroomingReviews,
  enqueueStaleBeatGroomingReviews,
} from "@/lib/stale-beat-grooming-api";
import {
  overviewBeatLabel,
} from "@/lib/beat-state-overview";
import {
  STALE_GROOMING_DECISION_LABELS,
} from "@/lib/stale-beat-grooming-types";
import type {
  StaleBeatGroomingReviewRecord,
  StaleBeatSummary,
} from "@/lib/stale-beat-grooming-types";
import { fetchAgents } from "@/lib/settings-api";
import type { Beat, RegisteredAgent } from "@/lib/types";

interface StaleBeatGroomingPanelProps {
  beats: Beat[];
  isAllRepositories: boolean;
  onOpenBeat: (beat: Beat) => void;
}

const REVIEW_QUERY_KEY = ["stale-beat-grooming", "reviews"] as const;

export function StaleBeatGroomingPanel({
  beats,
  isAllRepositories,
  onOpenBeat,
}: StaleBeatGroomingPanelProps) {
  const [nowMs] = useState(() => Date.now());
  const staleBeats = useMemo(
    () => getStaleBeatSummaries(beats, nowMs),
    [beats, nowMs],
  );
  const [deselectedKeys, setDeselectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const selectedKeys = useMemo(
    () => selectedStaleKeys(staleBeats, deselectedKeys),
    [staleBeats, deselectedKeys],
  );

  const agentsQuery = useQuery({
    queryKey: ["settings", "agents"],
    queryFn: fetchAgents,
  });
  const reviewsQuery = useQuery({
    queryKey: REVIEW_QUERY_KEY,
    queryFn: fetchStaleBeatGroomingReviews,
    enabled: staleBeats.length > 0,
    refetchInterval: 4000,
  });
  const reviewsByKey = useMemo(
    () => reviewMap(reviewsQuery.data?.data ?? []),
    [reviewsQuery.data],
  );

  const agents = agentsQuery.data?.data ?? {};
  const agentIds = Object.keys(agents);
  const [agentId, setAgentId] = useState("");
  const [modelOverride, setModelOverride] = useState("");
  const selectedCount = selectedKeys.size;
  const mutation = useGroomingMutation();

  return (
    <section
      className={
        "min-w-0 rounded-md border border-border/70 bg-background"
        + " lg:w-[320px] lg:shrink-0"
      }
      data-testid="stale-beat-grooming-panel"
    >
      <PanelHeader count={staleBeats.length} />
      <div className="space-y-2 p-2">
        <AgentControls
          agents={agents}
          agentIds={agentIds}
          agentId={agentId}
          modelOverride={modelOverride}
          disabled={staleBeats.length === 0}
          onAgentChange={setAgentId}
          onModelOverrideChange={setModelOverride}
        />
        <Button
          size="sm"
          className="h-8 w-full text-xs"
          disabled={
            mutation.isPending
            || staleBeats.length === 0
            || selectedCount === 0
            || !agentId
          }
          onClick={() => {
            const request = buildStaleBeatReviewRequest({
              summaries: staleBeats,
              selectedKeys,
              agentId,
              modelOverride,
            });
            mutation.mutate(request);
          }}
        >
          <Sparkles className="mr-1 size-3.5" />
          {mutation.isPending
            ? "Reviewing"
            : `Review ${selectedCount}`}
        </Button>
        <StaleBeatList
          staleBeats={staleBeats}
          selectedKeys={selectedKeys}
          reviewsByKey={reviewsByKey}
          isAllRepositories={isAllRepositories}
          onToggle={(key) =>
            setDeselectedKeys((current) =>
              toggledDeselectedKeys(
                current,
                key,
                selectedKeys.has(key),
              ))}
          onOpenBeat={onOpenBeat}
        />
      </div>
    </section>
  );
}

function PanelHeader({ count }: { count: number }) {
  return (
    <div className={
      "flex min-h-8 items-center justify-between gap-2"
      + " border-b border-border/70 bg-muted/35 px-2 py-1"
    }>
      <div className="min-w-0 text-xs font-medium">
        Stale Beats
      </div>
      <span className={
        "rounded-sm bg-background px-1.5 text-[10px]"
        + " leading-4 text-muted-foreground tabular-nums"
      }>
        {count}
      </span>
    </div>
  );
}

function AgentControls({
  agents,
  agentIds,
  agentId,
  modelOverride,
  disabled,
  onAgentChange,
  onModelOverrideChange,
}: {
  agents: Record<string, RegisteredAgent>;
  agentIds: string[];
  agentId: string;
  modelOverride: string;
  disabled: boolean;
  onAgentChange: (value: string) => void;
  onModelOverrideChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-1.5">
      <Select
        value={agentId}
        onValueChange={onAgentChange}
        disabled={disabled || agentIds.length === 0}
      >
        <SelectTrigger
          className="h-8 min-w-0 border-primary/20 text-xs"
        >
          <SelectValue
            placeholder={agentIds.length > 0 ? "agent" : "no agents"}
          />
        </SelectTrigger>
        <SelectContent>
          {agentIds.map((id) => (
            <SelectItem key={id} value={id}>
              {agents[id]
                ? <AgentDisplayLabel agent={agents[id]!} />
                : id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={modelOverride}
        disabled={disabled}
        onChange={(event) =>
          onModelOverrideChange(event.target.value)}
        placeholder="model"
        className="h-8 min-w-0 px-2 text-xs"
      />
    </div>
  );
}

function StaleBeatList({
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
      <div className="py-4 text-center text-[11px] text-muted-foreground">
        No stale beats
      </div>
    );
  }
  return (
    <div className="max-h-[360px] overflow-y-auto divide-y divide-border/60">
      {staleBeats.map((summary) => (
        <StaleBeatRow
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

function StaleBeatRow({
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
    <div className="flex items-start gap-1.5 py-2">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${label}`}
        className="mt-1 size-3 shrink-0"
      />
      <button
        type="button"
        onClick={onOpenBeat}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-[10px]">
            {label}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {summary.ageDays}d
          </span>
        </div>
        <div className="truncate text-[11px] leading-4">
          {summary.title}
        </div>
        {review && <ReviewStatusLine review={review} />}
      </button>
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
    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
      {label}
      {review.error ? `: ${review.error}` : ""}
      {review.result?.rationale ? `: ${review.result.rationale}` : ""}
    </div>
  );
}

function useGroomingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: enqueueStaleBeatGroomingReviews,
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.error ?? "Failed to review stale beats");
        return;
      }
      const count = result.data?.jobs.length ?? 0;
      toast.success(
        `${count} stale beat review${count === 1 ? "" : "s"} queued`,
      );
      await queryClient.invalidateQueries({
        queryKey: REVIEW_QUERY_KEY,
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to review stale beats",
      );
    },
  });
}

function reviewMap(
  reviews: StaleBeatGroomingReviewRecord[],
): Map<string, StaleBeatGroomingReviewRecord> {
  return new Map(reviews.map((review) => [review.key, review]));
}

function selectedStaleKeys(
  staleBeats: StaleBeatSummary[],
  deselectedKeys: ReadonlySet<string>,
): Set<string> {
  return new Set(
    staleBeats
      .map((beat) => beat.key)
      .filter((key) => !deselectedKeys.has(key)),
  );
}

function toggledDeselectedKeys(
  current: ReadonlySet<string>,
  key: string,
  currentlySelected: boolean,
): Set<string> {
  const next = new Set(current);
  if (currentlySelected) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}
