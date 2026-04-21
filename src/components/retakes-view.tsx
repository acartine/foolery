"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { compareBeatsByMostRecentlyUpdated } from "@/lib/beat-sort";
import { useAppStore } from "@/stores/app-store";
import type { Beat } from "@/lib/types";
import { RetakeDialog } from "@/components/retake-dialog";
import {
  isWaveLabel, extractWaveSlug, isInternalLabel,
} from "@/lib/wave-slugs";
import { ChevronRight } from "lucide-react";
import {
  relativeTime,
  RetakeRowTitle,
  RetakeRowLabels,
} from "@/components/retake-row-parts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateUrl } from "@/hooks/use-update-url";
import { firstBeatAlias } from "@/lib/beat-display";
import { useTerminalStore } from "@/stores/terminal-store";
import type { RetakeAction } from "@/components/retake-dialog";
import {
  BeatMetadataDetails,
} from "@/components/beat-metadata-details";
import {
  buildRetakeParentIndex,
  buildRetakeShippingIndex,
} from "@/lib/retake-session-scope";
import {
  useRetakesQuery,
  useRetakeMutation,
  extractCommitSha,
} from "@/lib/retake-view-helpers";
import { useBeatsScreenWarmup } from "@/hooks/use-beats-screen-warmup";
import { RepoSwitchLoadingState } from "@/components/repo-switch-loading-state";
import type {
  RetakesQueryResult,
} from "@/lib/retake-view-helpers";

function RetakeDetails({
  beat,
  showExpandedDetails,
}: {
  beat: Beat;
  showExpandedDetails: boolean;
}) {
  return (
    <BeatMetadataDetails
      beat={beat}
      showExpandedDetails={showExpandedDetails}
      formatRelativeTime={relativeTime}
    />
  );
}

function RetakeRow({
  beat,
  onRetake,
  onTitleClick,
}: {
  beat: Beat;
  onRetake: (beat: Beat) => void;
  onTitleClick?: (beat: Beat) => void;
}) {
  const [showExpanded, setShowExpanded] = useState(false);
  const labels = beat.labels ?? [];
  const waveSlug = extractWaveSlug(labels) ?? undefined;
  const isOrchestrated = labels.some(isWaveLabel);
  const visibleLabels = labels.filter(
    (l) => !isInternalLabel(l),
  );
  const commitSha = extractCommitSha(beat);
  const qualifiedId =
    firstBeatAlias(beat.aliases) ?? beat.id;

  return (
    <div className={
      "flex items-start gap-3 border-b"
      + " border-border/40 px-2 py-2.5 hover:bg-muted/30"
    }>
      <button
        type="button"
        className={
          "mt-0.5 shrink-0 rounded p-0.5"
          + " text-muted-foreground"
          + " hover:bg-muted/50 transition-transform"
        }
        aria-expanded={showExpanded}
        aria-label={
          showExpanded ? "Collapse details" : "Expand details"
        }
        title={
          showExpanded ? "Collapse details" : "Expand details"
        }
        onClick={() => setShowExpanded((prev) => !prev)}
      >
        <ChevronRight className={
          "size-4 transition-transform"
          + (showExpanded ? " rotate-90" : "")
        } />
      </button>

      <div className="min-w-0 flex-1">
        <RetakeRowTitle
          beat={beat}
          qualifiedId={qualifiedId}
          waveSlug={waveSlug}
          onTitleClick={onTitleClick}
        />
        <RetakeRowLabels
          beat={beat}
          commitSha={commitSha}
          isOrchestrated={isOrchestrated}
          visibleLabels={visibleLabels}
        />
        <RetakeDetails
          beat={beat}
          showExpandedDetails={showExpanded}
        />
      </div>

      <button
        type="button"
        className={
          "shrink-0 rounded-md border border-feature-400"
          + " bg-feature-100 px-3 py-1.5 text-xs font-semibold"
          + " text-feature-700 hover:bg-feature-100"
          + " hover:border-feature-400 transition-colors"
        }
        title="Flag regression and reopen this beat"
        onClick={() => onRetake(beat)}
      >
        ReTake
      </button>
    </div>
  );
}

function RetakesPagination({
  pageIndex,
  pageCount,
  pageSize,
  setPageIndex,
  updateUrl,
}: {
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  setPageIndex: (fn: (p: number) => number) => void;
  updateUrl: (params: { pageSize: number }) => void;
}) {
  return (
    <div className={
      "flex flex-wrap items-center"
      + " justify-between gap-2 px-2"
    }>
      <div className="text-sm text-muted-foreground">
        Page {pageIndex + 1} of {pageCount}
      </div>
      <div className="flex items-center gap-1">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const size = Number(v);
            setPageIndex(() => 0);
            updateUrl({ pageSize: size });
          }}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          title="Previous page"
          onClick={() => setPageIndex(
            (p) => Math.max(0, p - 1),
          )}
          disabled={pageIndex === 0}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Next page"
          onClick={() => setPageIndex(
            (p) => Math.min(pageCount - 1, p + 1),
          )}
          disabled={pageIndex >= pageCount - 1}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function RetakesLoading() {
  return (
    <RepoSwitchLoadingState
      data-testid="repo-switch-loading-retakes"
      label="Loading ReTakes..."
    />
  );
}

function RetakesError({ error }: { error: unknown }) {
  const message = error instanceof Error
    ? error.message
    : "Failed to load retake beats.";
  const showDetail =
    message !== "Failed to load retake beats.";
  return (
    <div className={
      "flex flex-col items-center justify-center"
      + " gap-1 py-6 text-sm text-destructive"
    }>
      <p>Failed to load retake beats.</p>
      {showDetail ? (
        <p className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function RetakesEmpty() {
  return (
    <div className={
      "flex flex-col items-center justify-center"
      + " py-12 text-muted-foreground"
    }>
      <p className="text-sm">No shipped beats found.</p>
      <p className="mt-1 text-xs">
        Shipped beats will appear here for regression
        tracking.
      </p>
    </div>
  );
}

function RetakesContent({
  beats,
  paginatedBeats,
  pagination,
  retakeBeat,
  dialogOpen,
  setDialogOpen,
  onRetake,
  onConfirm,
  isRetaking,
}: {
  beats: Beat[];
  paginatedBeats: Beat[];
  pagination: React.ReactNode;
  retakeBeat: Beat | null;
  dialogOpen: boolean;
  setDialogOpen: (v: boolean) => void;
  onRetake: (beat: Beat) => void;
  onConfirm: (notes: string, action: RetakeAction) => void;
  isRetaking: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="px-2">
        <div className="text-xs text-muted-foreground">
          {beats.length} shipped beat
          {beats.length !== 1 ? "s" : ""}
          {" — most recently updated first"}
        </div>
      </div>
      {pagination}
      <div className="rounded-md border border-border/60">
        {paginatedBeats.map((beat) => (
          <RetakeRow
            key={beat.id}
            beat={beat}
            onRetake={onRetake}
          />
        ))}
      </div>
      {pagination}
      <RetakeDialog
        beat={retakeBeat}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={onConfirm}
        isPending={isRetaking}
      />
    </div>
  );
}

export function RetakesView() {
  const { activeRepo, registeredRepos, pageSize } =
    useAppStore();
  const updateUrl = useUpdateUrl();
  const [retakeBeat, setRetakeBeat] =
    useState<Beat | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const {
    terminals, setActiveSession, upsertTerminal,
  } = useTerminalStore();

  const shippingByBeatId = useMemo(
    () => buildRetakeShippingIndex(terminals),
    [terminals],
  );
  const { data, isLoading, error } = useRetakesQuery(
    activeRepo, registeredRepos,
  );
  useBeatsScreenWarmup(
    "retakes",
    !isLoading && !error && data?.ok === true,
  );
  const parentByBeatId = useMemo(
    () => buildRetakeParentIndex(
      (data as RetakesQueryResult)?.allBeats ?? [],
    ),
    [data],
  );
  const beats = useMemo<Beat[]>(() => {
    if (!data?.ok || !data.data) return [];
    return [...data.data].sort(
      compareBeatsByMostRecentlyUpdated,
    );
  }, [data]);

  const pageCount = Math.max(
    1, Math.ceil(beats.length / pageSize),
  );
  const paginatedBeats = useMemo(() => {
    const start = pageIndex * pageSize;
    return beats.slice(start, start + pageSize);
  }, [beats, pageIndex, pageSize]);

  // Reset pagination when dataset size changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPageIndex(0), [beats.length]);

  const {
    mutate: doRetake, isPending: isRetaking,
  } = useRetakeMutation({
    beats,
    activeRepo,
    terminals,
    parentByBeatId,
    shippingByBeatId,
    setActiveSession,
    upsertTerminal,
    setDialogOpen,
    setRetakeBeat,
  });

  const handleOpenRetake = useCallback((beat: Beat) => {
    setRetakeBeat(beat);
    setDialogOpen(true);
  }, []);

  const handleConfirmRetake = useCallback(
    (notes: string, action: RetakeAction) => {
      if (retakeBeat) {
        doRetake({ beat: retakeBeat, notes, action });
      }
    },
    [retakeBeat, doRetake],
  );

  if (isLoading) return <RetakesLoading />;
  if (error) return <RetakesError error={error} />;
  if (beats.length === 0) return <RetakesEmpty />;

  const pagination = pageCount > 1 ? (
    <RetakesPagination
      pageIndex={pageIndex}
      pageCount={pageCount}
      pageSize={pageSize}
      setPageIndex={setPageIndex}
      updateUrl={updateUrl}
    />
  ) : null;

  return (
    <RetakesContent
      beats={beats}
      paginatedBeats={paginatedBeats}
      pagination={pagination}
      retakeBeat={retakeBeat}
      dialogOpen={dialogOpen}
      setDialogOpen={setDialogOpen}
      onRetake={handleOpenRetake}
      onConfirm={handleConfirmRetake}
      isRetaking={isRetaking}
    />
  );
}
