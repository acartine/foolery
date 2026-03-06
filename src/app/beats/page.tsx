"use client";

import { Suspense, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBeats } from "@/lib/api";
import { startSession, abortSession } from "@/lib/terminal-api";
import { BeatTable } from "@/components/beat-table";
import { BeatDetailLightbox } from "@/components/beat-detail-lightbox";
import { FilterBar, type ViewPhase } from "@/components/filter-bar";
import { MergeBeatsDialog } from "@/components/merge-beats-dialog";
import { FinalCutView } from "@/components/final-cut-view";
import { RetakesView } from "@/components/retakes-view";
import { AgentHistoryView } from "@/components/agent-history-view";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore, type QueuedBeat } from "@/stores/terminal-store";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import type { AgentInfo } from "@/components/beat-columns";
import {
  formatAgentFamily,
  normalizeAgentIdentity,
} from "@/lib/agent-identity";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";

const DEGRADED_ERROR_PREFIX = "Unable to interact with beats store";
const MAX_SESSIONS = 5;

/** Thrown when the backend reports a degraded beats store.
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

function toActiveAgentInfo(input: {
  agentCommand?: string;
  agentName?: string;
  model?: string;
  version?: string;
}): AgentInfo {
  const normalized = normalizeAgentIdentity({
    command: input.agentCommand ?? input.agentName,
    model: input.model,
    version: input.version,
  });
  const family = formatAgentFamily({
    provider: normalized.provider,
    model: normalized.model,
    flavor: normalized.flavor,
  });
  return {
    agentName: input.agentName,
    model: family || input.model,
    version: normalized.version,
  };
}

export default function BeatsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-6 text-muted-foreground">Loading beats...</div>}>
      <BeatsPageInner />
    </Suspense>
  );
}

function BeatsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchQuery = searchParams.get("q") ?? "";
  const detailBeatId = searchParams.get("beat");
  const detailRepo = searchParams.get("detailRepo") ?? undefined;
  const viewParam = searchParams.get("view");
  const beatsView: "queues" | "active" | "finalcut" | "retakes" | "history" =
    viewParam === "active"
      ? "active"
      : viewParam === "finalcut"
        ? "finalcut"
        : viewParam === "retakes"
          ? "retakes"
          : viewParam === "history"
            ? "history"
            : "queues";
  const isListView = beatsView === "queues" || beatsView === "active";
  const viewPhase: ViewPhase = beatsView === "active" ? "active" : "queues";
  const isFinalCutView = beatsView === "finalcut";
  const isRetakesView = beatsView === "retakes";
  const isHistoryView = beatsView === "history";
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
    sceneQueue,
    enqueueSceneBeats,
    dequeueSceneBeats,
  } = useTerminalStore();
  const shippingByBeatId = terminals.reduce<Record<string, string>>(
    (acc, terminal) => {
      if (terminal.status === "running") {
        acc[terminal.beatId] = terminal.sessionId;
      }
      return acc;
    },
    {}
  );

  const params: Record<string, string> = {};
  if (filters.state) params.state = filters.state;
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) params.priority = String(filters.priority);
  if (searchQuery) params.q = searchQuery;

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["beats", params, activeRepo, registeredRepos.length],
    queryFn: async () => {
      const fetcher = fetchBeats;
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
  const parentByBeatId = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const beat of beats) map.set(beat.id, beat.parent);
    return map;
  }, [beats]);

  const hasRollingAncestor = useCallback((beat: Pick<Beat, "id" | "parent">): boolean => {
    let parentId = beat.parent;
    const visited = new Set<string>();

    while (parentId) {
      if (shippingByBeatId[parentId]) return true;
      if (visited.has(parentId)) break;
      visited.add(parentId);
      parentId = parentByBeatId.get(parentId);
    }

    return false;
  }, [parentByBeatId, shippingByBeatId]);

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
  const isActiveView = beatsView === "active";

  const agentInfoByBeatId = useMemo<Record<string, AgentInfo>>(() => {
    if (!isActiveView) return {};
    const map: Record<string, AgentInfo> = {};

    // Populate from handoff capsules in beat metadata (last capsule wins).
    for (const beat of beats) {
      const capsules = beat.metadata?.knotsHandoffCapsules;
      if (Array.isArray(capsules) && capsules.length > 0) {
        const last = capsules[capsules.length - 1] as Record<string, unknown>;
        map[beat.id] = toActiveAgentInfo({
          agentCommand: typeof last.agentname === "string" ? last.agentname : undefined,
          agentName: typeof last.agentname === "string" ? last.agentname : undefined,
          model: typeof last.model === "string" ? last.model : undefined,
          version: typeof last.version === "string" ? last.version : undefined,
        });
      }
    }

    // Override with live terminal data for currently running sessions.
    for (const terminal of terminals) {
      if (terminal.status === "running") {
        map[terminal.beatId] = {
          agentName: terminal.agentName ?? map[terminal.beatId]?.agentName,
          ...toActiveAgentInfo({
            agentCommand: terminal.agentCommand,
            agentName: terminal.agentName,
            model: terminal.agentModel,
            version: terminal.agentVersion,
          }),
        };
      }
    }

    return map;
  }, [isActiveView, beats, terminals]);

  const { mutate: bulkUpdate } = useMutation({
    mutationFn: async ({ ids, fields }: { ids: string[]; fields: UpdateBeatInput }) => {
      await Promise.all(ids.map((id) => updateBeatOrThrow(beats, id, fields)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beats"] });
      setSelectionVersion((v) => v + 1);
      toast.success("Beats updated");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update beats";
      toast.error(message);
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

      if (hasRollingAncestor(beat)) {
        toast.info("Parent beat is already rolling");
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
        agentName: result.data.agentName,
        agentModel: result.data.agentModel,
        agentVersion: result.data.agentVersion,
        agentCommand: result.data.agentCommand,
        status: "running",
        startedAt: result.data.startedAt,
      });
    },
    [activeRepo, hasRollingAncestor, setActiveSession, terminals, upsertTerminal]
  );

  const handleAbortShipping = useCallback(async (beatId: string) => {
    const running = terminals.find(
      (terminal) =>
        terminal.status === "running" && terminal.beatId === beatId
    );
    if (!running) return;

    const result = await abortSession(running.sessionId);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to terminate session");
      return;
    }
    updateStatus(running.sessionId, "aborted");
    toast.success("Take terminated");
  }, [terminals, updateStatus]);

  const launchTakeForQueuedBeat = useCallback(
    async (item: QueuedBeat) => {
      const result = await startSession(item.beatId, item.repoPath ?? activeRepo ?? undefined);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? `Failed to start session for ${item.beatId}`);
        return;
      }
      upsertTerminal({
        sessionId: result.data.id,
        beatId: item.beatId,
        beatTitle: item.beatTitle,
        repoPath: result.data.repoPath ?? item.repoPath ?? activeRepo ?? undefined,
        agentName: result.data.agentName,
        agentModel: result.data.agentModel,
        agentVersion: result.data.agentVersion,
        agentCommand: result.data.agentCommand,
        status: "running",
        startedAt: result.data.startedAt,
      });
    },
    [activeRepo, upsertTerminal]
  );

  const drainingRef = useRef(false);

  const handleSceneBeats = useCallback(
    async (ids: string[]) => {
      const selectedBeats = beats.filter((b) => ids.includes(b.id));
      if (selectedBeats.length === 0) return;

      const runningCount = terminals.filter((t) => t.status === "running").length;
      const availableSlots = Math.max(0, MAX_SESSIONS - runningCount);

      const toLaunch = selectedBeats.slice(0, availableSlots);
      const toQueue = selectedBeats.slice(availableSlots);

      for (const beat of toLaunch) {
        await handleShipBeat(beat);
      }

      if (toQueue.length > 0) {
        const queued: QueuedBeat[] = toQueue.map((beat) => ({
          beatId: beat.id,
          beatTitle: beat.title,
          repoPath: (beat as unknown as Record<string, unknown>)._repoPath as string | undefined,
        }));
        enqueueSceneBeats(queued);
        toast.info(`${toQueue.length} beat${toQueue.length > 1 ? "s" : ""} queued (waiting for available slots)`);
      }
    },
    [beats, terminals, handleShipBeat, enqueueSceneBeats]
  );

  // Drain the scene queue as sessions complete and slots open up
  useEffect(() => {
    if (sceneQueue.length === 0 || drainingRef.current) return;

    const runningCount = terminals.filter((t) => t.status === "running").length;
    if (runningCount >= MAX_SESSIONS) return;

    const slotsAvailable = MAX_SESSIONS - runningCount;
    const batch = dequeueSceneBeats(slotsAvailable);
    if (batch.length === 0) return;

    drainingRef.current = true;
    const launch = async () => {
      for (const item of batch) {
        await launchTakeForQueuedBeat(item);
      }
      drainingRef.current = false;
    };
    launch();
  }, [sceneQueue, terminals, dequeueSceneBeats, launchTakeForQueuedBeat]);

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
    if (id) params.set("beat", id);
    else params.delete("beat");

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
    queryClient.invalidateQueries({ queryKey: ["beats"] });
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
    <div className="mx-auto max-w-[95vw] overflow-x-hidden px-4 pt-2">
      {isListView && (
        <div className="mb-2 flex h-10 items-center border-b border-border/60 pb-2">
          <FilterBar
            viewPhase={viewPhase}
            selectedIds={selectedIds}
            onBulkUpdate={handleBulkUpdate}
            onClearSelection={handleClearSelection}
            onSceneBeats={handleSceneBeats}
            onMergeBeats={handleMergeBeats}
          />
        </div>
      )}

      <div className="mt-0.5">
        {isFinalCutView ? (
          <FinalCutView />
        ) : isRetakesView ? (
          <RetakesView />
        ) : isHistoryView ? (
          <AgentHistoryView />
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
                showAgentColumns={isActiveView}
                agentInfoByBeatId={agentInfoByBeatId}
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
          isParentRollingBeat={hasRollingAncestor}
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
