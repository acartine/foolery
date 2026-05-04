"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck,
  Eraser,
  ListFilter,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildStaleBeatReviewRequest,
  getStaleBeatSummaries,
  selectOldestStaleBeatSummaries,
} from "@/lib/stale-beat-grooming";
import {
  fetchStaleBeatGroomingOptions,
  fetchStaleBeatGroomingReviews,
  enqueueStaleBeatGroomingReviews,
} from "@/lib/stale-beat-grooming-api";
import {
  StaleBeatDialogList,
} from "@/components/stale-beat-grooming-dialog-list";
import type {
  StaleBeatGroomingAgentOption,
  StaleBeatGroomingReviewRecord,
  StaleBeatSummary,
} from "@/lib/stale-beat-grooming-types";
import type { Beat } from "@/lib/types";

interface StaleBeatGroomingDialogProps {
  beats: Beat[];
  isAllRepositories: boolean;
  onOpenBeat: (beat: Beat) => void;
}

const REVIEW_QUERY_KEY = ["stale-beat-grooming", "reviews"] as const;

export function StaleBeatGroomingDialog({
  beats,
  isAllRepositories,
  onOpenBeat,
}: StaleBeatGroomingDialogProps) {
  const [open, setOpen] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const staleBeats = useMemo(
    () => getStaleBeatSummaries(beats, nowMs),
    [beats, nowMs],
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [agentId, setAgentId] = useState("");

  useDefaultSelection(staleBeats, setSelectedKeys);

  const optionsQuery = useQuery({
    queryKey: ["stale-beat-grooming", "options"],
    queryFn: fetchStaleBeatGroomingOptions,
    enabled: open,
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
  const queuedCount = staleBeats.filter((summary) =>
    isQueuedReview(reviewsByKey.get(summary.key))
  ).length;

  const options = optionsQuery.data?.data;
  const agents = options?.agents ?? [];
  useDefaultAgent(agents, options?.defaultAgentId, setAgentId);

  const mutation = useGroomingMutation();
  const selectedCount = selectedKeys.size;
  const canReview =
    staleBeats.length > 0
    && selectedCount > 0
    && Boolean(agentId)
    && !mutation.isPending;
  const handleReview = () => {
    const request = buildStaleBeatReviewRequest({
      summaries: staleBeats,
      selectedKeys,
      agentId,
    });
    mutation.mutate(request);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={staleBeats.length > 0 ? "secondary" : "outline"}
          className="h-8 gap-1.5"
          data-testid="stale-beats-dialog-trigger"
        >
          <Sparkles className="size-3.5" />
          <span>Stale Beats</span>
          <Badge variant="outline" className="h-4 rounded-sm text-[10px]">
            {staleBeats.length}
          </Badge>
          {queuedCount > 0 && (
            <Badge className="h-4 rounded-sm text-[10px]">
              Queued {queuedCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <StaleBeatGroomingDialogContent
        staleBeats={staleBeats}
        agents={agents}
        agentId={agentId}
        selectedKeys={selectedKeys}
        selectedCount={selectedCount}
        defaultError={options?.defaultError}
        pending={mutation.isPending}
        canReview={canReview}
        reviewsByKey={reviewsByKey}
        isAllRepositories={isAllRepositories}
        onAgentChange={setAgentId}
        onSelectAll={() => selectAll(staleBeats, setSelectedKeys)}
        onSelectOldest={() => selectOldestFive(staleBeats, setSelectedKeys)}
        onClear={() => setSelectedKeys(new Set())}
        onReview={handleReview}
        onToggle={(key) => toggleSelected(key, setSelectedKeys)}
        onOpenBeat={(beat) => {
          setOpen(false);
          onOpenBeat(beat);
        }}
      />
    </Dialog>
  );
}

function StaleBeatGroomingDialogContent({
  staleBeats,
  agents,
  agentId,
  selectedKeys,
  selectedCount,
  defaultError,
  pending,
  canReview,
  reviewsByKey,
  isAllRepositories,
  onAgentChange,
  onSelectAll,
  onSelectOldest,
  onClear,
  onReview,
  onToggle,
  onOpenBeat,
}: {
  staleBeats: StaleBeatSummary[];
  agents: StaleBeatGroomingAgentOption[];
  agentId: string;
  selectedKeys: ReadonlySet<string>;
  selectedCount: number;
  defaultError?: string;
  pending: boolean;
  canReview: boolean;
  reviewsByKey: Map<string, StaleBeatGroomingReviewRecord>;
  isAllRepositories: boolean;
  onAgentChange: (value: string) => void;
  onSelectAll: () => void;
  onSelectOldest: () => void;
  onClear: () => void;
  onReview: () => void;
  onToggle: (key: string) => void;
  onOpenBeat: (beat: Beat) => void;
}) {
  return (
    <DialogContent
      className={
        "flex max-h-[86vh] flex-col gap-3 overflow-hidden"
        + " p-4 sm:max-w-3xl"
      }
      data-testid="stale-beat-grooming-dialog"
    >
      <DialogHeader className="gap-1">
        <DialogTitle>Stale Beats</DialogTitle>
        <DialogDescription>
          {staleBeats.length} older than 7 days since last update
        </DialogDescription>
      </DialogHeader>
      <DialogControls
        agents={agents}
        agentId={agentId}
        selectedCount={selectedCount}
        defaultError={defaultError}
        pending={pending}
        onAgentChange={onAgentChange}
        onSelectAll={onSelectAll}
        onSelectOldest={onSelectOldest}
        onClear={onClear}
        onReview={onReview}
        canReview={canReview}
      />
      <StaleBeatDialogList
        staleBeats={staleBeats}
        selectedKeys={selectedKeys}
        reviewsByKey={reviewsByKey}
        isAllRepositories={isAllRepositories}
        onToggle={onToggle}
        onOpenBeat={onOpenBeat}
      />
    </DialogContent>
  );
}

function DialogControls({
  agents,
  agentId,
  selectedCount,
  defaultError,
  pending,
  canReview,
  onAgentChange,
  onSelectAll,
  onSelectOldest,
  onClear,
  onReview,
}: {
  agents: StaleBeatGroomingAgentOption[];
  agentId: string;
  selectedCount: number;
  defaultError?: string;
  pending: boolean;
  canReview: boolean;
  onAgentChange: (value: string) => void;
  onSelectAll: () => void;
  onSelectOldest: () => void;
  onClear: () => void;
  onReview: () => void;
}) {
  return (
    <div className="grid gap-2 border-y border-border/70 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Model</span>
        <Select
          value={agentId}
          onValueChange={onAgentChange}
          disabled={agents.length === 0}
        >
          <SelectTrigger className="h-8 w-[260px] min-w-0 text-xs">
            <SelectValue
              placeholder={agents.length > 0 ? "Choose model" : "No models"}
            />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agentLabel(agent)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {defaultError && (
          <span className="min-w-0 text-xs text-destructive">
            {defaultError}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onSelectAll}>
          <CheckCheck className="size-3.5" />
          Select all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onSelectOldest}
        >
          <ListFilter className="size-3.5" />
          Oldest five
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          <Eraser className="size-3.5" />
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onReview}
          disabled={!canReview}
          className="w-full sm:ml-auto sm:w-auto"
        >
          <Sparkles className="size-3.5" />
          {pending ? "Reviewing" : `Review ${selectedCount}`}
        </Button>
      </div>
    </div>
  );
}

function useDefaultSelection(
  staleBeats: StaleBeatSummary[],
  setSelectedKeys: (fn: (current: Set<string>) => Set<string>) => void,
) {
  useEffect(() => {
    setSelectedKeys((current) => {
      const validKeys = new Set(staleBeats.map((beat) => beat.key));
      const stillValid = new Set(
        [...current].filter((key) => validKeys.has(key)),
      );
      if (stillValid.size > 0 || staleBeats.length === 0) {
        return stillValid;
      }
      return oldestKeySet(staleBeats);
    });
  }, [staleBeats, setSelectedKeys]);
}

function useDefaultAgent(
  agents: StaleBeatGroomingAgentOption[],
  defaultAgentId: string | undefined,
  setAgentId: (fn: (current: string) => string) => void,
) {
  useEffect(() => {
    setAgentId((current) => {
      const agentIds = new Set(agents.map((agent) => agent.id));
      if (current && agentIds.has(current)) return current;
      return defaultAgentId && agentIds.has(defaultAgentId)
        ? defaultAgentId
        : "";
    });
  }, [agents, defaultAgentId, setAgentId]);
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

function selectAll(
  staleBeats: StaleBeatSummary[],
  setSelectedKeys: (value: Set<string>) => void,
) {
  setSelectedKeys(new Set(staleBeats.map((beat) => beat.key)));
}

function selectOldestFive(
  staleBeats: StaleBeatSummary[],
  setSelectedKeys: (value: Set<string>) => void,
) {
  setSelectedKeys(oldestKeySet(staleBeats));
}

function oldestKeySet(staleBeats: StaleBeatSummary[]): Set<string> {
  return new Set(
    selectOldestStaleBeatSummaries(staleBeats, 5)
      .map((beat) => beat.key),
  );
}

function toggleSelected(
  key: string,
  setSelectedKeys: (fn: (current: Set<string>) => Set<string>) => void,
) {
  setSelectedKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  });
}

function reviewMap(
  reviews: StaleBeatGroomingReviewRecord[],
): Map<string, StaleBeatGroomingReviewRecord> {
  return new Map(reviews.map((review) => [review.key, review]));
}

function isQueuedReview(
  review: StaleBeatGroomingReviewRecord | undefined,
): boolean {
  return review?.status === "queued" || review?.status === "running";
}

function agentLabel(agent: StaleBeatGroomingAgentOption): string {
  return agent.model
    ? `${agent.label} (${agent.model})`
    : agent.label;
}
