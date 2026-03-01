"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBeads, fetchReadyBeads, updateBead } from "@/lib/api";
import { startSession, startSceneSession, abortSession } from "@/lib/terminal-api";
import { BeatTable } from "@/components/beat-table";
import { BeatDetailLightbox } from "@/components/beat-detail-lightbox";
import { FilterBar } from "@/components/filter-bar";
import { MergeBeatsDialog } from "@/components/merge-beats-dialog";
import { OrchestrationView } from "@/components/orchestration-view";
import { ExistingOrchestrationsView } from "@/components/existing-orchestrations-view";
import { FinalCutView } from "@/components/final-cut-view";
import { RetakesView } from "@/components/retakes-view";
import { BreakdownView } from "@/components/breakdown-view";
import { AgentHistoryView } from "@/components/agent-history-view";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useRetryNotifications } from "@/hooks/use-retry-notifications";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";

const DEGRADED_ERROR_PREFIX = "Unable to interact with beads store";

/** Thrown when the backend reports a degraded beads store.
 *  React Query keeps previous data when the queryFn throws. */
class DegradedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DegradedStoreError";
  }
}

function throwIfDegraded(result: { ok: boolean; error?: string }): void {
  if (!result.ok && result.error?.startsWith(DEGRADED_ERROR_PREFIX)) {
    throw new DegradedStoreError(result.error);
  }
}

export default function BeadsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-6 text-muted-foreground">Loading beats...</div>}>
      <BeadsPageInner />
    </Suspense>
  );
}

function BeadsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchQuery = searchParams.get("q") ?? "";
  const detailBeatId = searchParams.get("bead");
  const detailRepo = searchParams.get("detailRepo") ?? undefined;
  const viewParam = searchParams.get("view");
  const beadsView: "list" | "orchestration" | "existing" | "finalcut" | "retakes" | "history" | "breakdown" =
    viewParam === "orchestration"
      ? "orchestration"
      : viewParam === "existing"
        ? "existing"
        : viewParam === "finalcut"
          ? "finalcut"
          : viewParam === "retakes"
            ? "retakes"
            : viewParam === "history"
              ? "history"
            : viewParam === "breakdown"
              ? "breakdown"
              : "list";
  const isOrchestrationView = beadsView === "orchestration";
  const isExistingOrchestrationView = beadsView === "existing";
  const isListView = beadsView === "list";
  const isFinalCutView = beadsView === "finalcut";
  const isRetakesView = beadsView === "retakes";
  const isHistoryView = beadsView === "history";
  const isBreakdownView = beadsView === "breakdown";
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeBeatIds, setMergeBeatIds] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { filters, activeRepo, registeredRepos } = useAppStore();
  const {
    terminals,
    setActiveSession,
    upsertTerminal,
    updateStatus,
  } = useTerminalStore();
  const shippingByBeatId = terminals.reduce<Record<string, string>>(
    (acc, terminal) => {
      if (terminal.status === "running") {
        if (terminal.beatIds && terminal.beatIds.length > 0) {
          for (const bid of terminal.beatIds) {
            acc[bid] = terminal.sessionId;
          }
        } else {
          acc[terminal.beatId] = terminal.sessionId;
        }
      }
      return acc;
    },
    {}
  );

  const isReadyFilter = filters.state === "ready";
  const params: Record<string, string> = {};
  if (filters.state && !isReadyFilter) params.state = filters.state;
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) params.priority = String(filters.priority);
  if (searchQuery) params.q = searchQuery;

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["beads", params, activeRepo, isReadyFilter, registeredRepos.length],
    queryFn: async () => {
      const fetcher = isReadyFilter ? fetchReadyBeads : fetchBeads;
      if (activeRepo) {
        const result = await fetcher(params, activeRepo);
        throwIfDegraded(result);
        if (result.ok && result.data) {
          const repo = registeredRepos.find((r) => r.path === activeRepo);
          result.data = result.data.map((beat) => ({
            ...beat,
            _repoPath: activeRepo,
            _repoName: repo?.name ?? activeRepo,
          })) as typeof result.data;
        }
        return result;
      }
      if (registeredRepos.length > 0) {
        let hasDegraded = false;
        let degradedMsg = "";
        const results = await Promise.all(
          registeredRepos.map(async (repo) => {
            const result = await fetcher(params, repo.path);
            if (!result.ok && result.error?.startsWith(DEGRADED_ERROR_PREFIX)) {
              hasDegraded = true;
              degradedMsg = result.error;
              return [];
            }
            if (!result.ok || !result.data) return [];
            return result.data.map((beat) => ({
              ...beat,
              _repoPath: repo.path,
              _repoName: repo.name,
            }));
          })
        );
        const merged = results.flat();
        if (merged.length === 0 && hasDegraded) {
          throw new DegradedStoreError(degradedMsg);
        }
        return { ok: true as const, data: merged, _degraded: hasDegraded ? degradedMsg : undefined };
      }
      const result = await fetcher(params);
      throwIfDegraded(result);
      return result;
    },
    enabled: isListView && (Boolean(activeRepo) || registeredRepos.length > 0),
    refetchInterval: 10_000,
    retry: (count, error) => !(error instanceof DegradedStoreError) && count < 3,
  });

  const beats = useMemo<Beat[]>(() => (data?.ok ? (data.data ?? []) : []), [data]);
  useRetryNotifications(beats);
  const partialDegradedMsg = data?.ok ? (data as { _degraded?: string })._degraded : undefined;
  const isDegradedError = queryError instanceof DegradedStoreError || Boolean(partialDegradedMsg);
  const loadError = queryError instanceof DegradedStoreError
    ? queryError.message
    : partialDegradedMsg
      ? partialDegradedMsg
      : data && !data.ok
        ? data.error ?? "Failed to load beats."
        : null;
  const showRepoColumn = !activeRepo && registeredRepos.length > 1;

  const { mutate: bulkUpdate } = useMutation({
    mutationFn: async ({ ids, fields }: { ids: string[]; fields: UpdateBeatInput }) => {
      await Promise.all(
        ids.map((id) => {
          const beat = beats.find((b) => b.id === id) as unknown as Record<string, unknown>;
          const repo = beat?._repoPath as string | undefined;
          return updateBead(id, fields, repo);
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      setSelectionVersion((v) => v + 1);
      toast.success("Beats updated");
    },
    onError: () => {
      toast.error("Failed to update beats");
    },
  });

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  const handleBulkUpdate = useCallback(
    (fields: UpdateBeatInput) => {
      if (selectedIds.length > 0) {
        bulkUpdate({ ids: selectedIds, fields });
      }
    },
    [selectedIds, bulkUpdate]
  );

  const handleClearSelection = useCallback(() => {
    setSelectionVersion((v) => v + 1);
  }, []);

  const handleShipBeat = useCallback(
    async (beat: Beat) => {
      const existingRunning = terminals.find(
        (terminal) => terminal.beatId === beat.id && terminal.status === "running"
      );
      if (existingRunning) {
        setActiveSession(existingRunning.sessionId);
        toast.info("Opened active session");
        return;
      }

      const repo = (beat as unknown as Record<string, unknown>)._repoPath as string | undefined;
      const result = await startSession(beat.id, repo ?? activeRepo ?? undefined);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "Failed to start terminal session");
        return;
      }
      upsertTerminal({
        sessionId: result.data.id,
        beatId: beat.id,
        beatTitle: beat.title,
        repoPath: result.data.repoPath ?? repo ?? activeRepo ?? undefined,
        status: "running",
        startedAt: new Date().toISOString(),
      });
    },
    [activeRepo, setActiveSession, terminals, upsertTerminal]
  );

  const handleAbortShipping = useCallback(async (beatId: string) => {
    const running = terminals.find(
      (terminal) =>
        terminal.status === "running" &&
        (terminal.beatId === beatId ||
         (terminal.beatIds && terminal.beatIds.includes(beatId)))
    );
    if (!running) return;

    const result = await abortSession(running.sessionId);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to terminate session");
      return;
    }
    updateStatus(running.sessionId, "aborted");
    toast.success(running.beatIds ? "Scene terminated" : "Take terminated");
  }, [terminals, updateStatus]);

  const handleSceneBeats = useCallback(
    async (ids: string[]) => {
      const firstBeat = beats.find((b) => ids.includes(b.id));
      const repo = (firstBeat as unknown as Record<string, unknown>)?._repoPath as string | undefined;

      const result = await startSceneSession(ids, repo ?? activeRepo ?? undefined);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "Failed to start scene session");
        return;
      }
      upsertTerminal({
        sessionId: result.data.id,
        beatId: result.data.beatId,
        beatTitle: result.data.beatTitle,
        beatIds: result.data.beatIds,
        repoPath: result.data.repoPath ?? repo ?? activeRepo ?? undefined,
        status: "running",
        startedAt: new Date().toISOString(),
      });
    },
    [beats, activeRepo, upsertTerminal]
  );

  const handleMergeBeats = useCallback(
    (ids: string[]) => {
      setMergeBeatIds(ids);
      setMergeDialogOpen(true);
    },
    []
  );

  const handleMergeComplete = useCallback(() => {
    setSelectionVersion((v) => v + 1);
  }, []);

  const setBeatDetailParams = useCallback((id: string | null, repo: string | undefined, mode: "push" | "replace") => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("bead", id);
    else params.delete("bead");

    if (repo) params.set("detailRepo", repo);
    else params.delete("detailRepo");

    const qs = params.toString();
    const nextUrl = `${pathname}${qs ? `?${qs}` : ""}`;
    if (mode === "replace") router.replace(nextUrl);
    else router.push(nextUrl);
  }, [searchParams, pathname, router]);

  useEffect(() => {
    if (!isListView && detailBeatId) {
      setBeatDetailParams(null, undefined, "replace");
    }
  }, [isListView, detailBeatId, setBeatDetailParams]);

  const handleOpenBeat = useCallback((beat: Beat) => {
    const repo = (beat as unknown as Record<string, unknown>)._repoPath as string | undefined;
    setBeatDetailParams(beat.id, repo, "push");
  }, [setBeatDetailParams]);

  const handleBeatLightboxOpenChange = useCallback((open: boolean) => {
    if (!open) setBeatDetailParams(null, undefined, "replace");
  }, [setBeatDetailParams]);

  const handleMovedBeat = useCallback((newId: string, targetRepo: string) => {
    setBeatDetailParams(newId, targetRepo, "replace");
    queryClient.invalidateQueries({ queryKey: ["beads"] });
  }, [queryClient, setBeatDetailParams]);

  const initialDetailBeat = useMemo(() => {
    if (!detailBeatId) return null;
    return beats.find((beat) => {
      if (beat.id !== detailBeatId) return false;
      const beatRepo = (beat as unknown as Record<string, unknown>)._repoPath as string | undefined;
      return !detailRepo || beatRepo === detailRepo;
    }) ?? null;
  }, [beats, detailBeatId, detailRepo]);

  return (
    <div className="mx-auto max-w-[95vw] overflow-hidden px-4 pt-2">
      {isListView && (
        <div className="mb-2 flex h-10 items-center border-b border-border/60 pb-2">
          <FilterBar
            selectedIds={selectedIds}
            onBulkUpdate={handleBulkUpdate}
            onClearSelection={handleClearSelection}
            onSceneBeads={handleSceneBeats}
            onMergeBeads={handleMergeBeats}
          />
        </div>
      )}

      <div className="mt-0.5">
        {isOrchestrationView ? (
          <OrchestrationView
            onApplied={() => {
              queryClient.invalidateQueries({ queryKey: ["beads"] });
            }}
          />
        ) : isExistingOrchestrationView ? (
          <ExistingOrchestrationsView />
        ) : isFinalCutView ? (
          <FinalCutView />
        ) : isRetakesView ? (
          <RetakesView />
        ) : isHistoryView ? (
          <AgentHistoryView />
        ) : isBreakdownView ? (
          <BreakdownView />
        ) : (
          <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              Loading beats...
            </div>
          ) : loadError && !isDegradedError ? (
            <div className="flex items-center justify-center py-6 text-sm text-destructive">
              Failed to load beats: {loadError}
            </div>
          ) : (
            <>
              {isDegradedError && (
                <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>{loadError}</span>
                </div>
              )}
              <BeatTable
                data={beats}
                showRepoColumn={showRepoColumn}
                onSelectionChange={handleSelectionChange}
                selectionVersion={selectionVersion}
                searchQuery={searchQuery}
                onOpenBeat={handleOpenBeat}
                onShipBeat={handleShipBeat}
                shippingByBeatId={shippingByBeatId}
                onAbortShipping={handleAbortShipping}
              />
            </>
          )}
          </div>
        )}
      </div>
      {isListView && (
        <BeatDetailLightbox
          key={`${detailBeatId ?? "none"}:${detailRepo ?? "none"}`}
          open={Boolean(detailBeatId)}
          beatId={detailBeatId}
          repo={detailRepo}
          initialBeat={initialDetailBeat}
          onOpenChange={handleBeatLightboxOpenChange}
          onMoved={handleMovedBeat}
          onShipBeat={handleShipBeat}
        />
      )}
      {isListView && (
        <MergeBeatsDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          beats={beats.filter((b) => mergeBeatIds.includes(b.id))}
          onMerged={handleMergeComplete}
        />
      )}
    </div>
  );
}
