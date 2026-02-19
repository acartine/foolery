"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBeads, fetchReadyBeads, updateBead } from "@/lib/api";
import { startSession, startSceneSession, abortSession } from "@/lib/terminal-api";
import { fetchRegistry } from "@/lib/registry-api";
import { BeadTable } from "@/components/bead-table";
import { BeadDetailLightbox } from "@/components/bead-detail-lightbox";
import { FilterBar } from "@/components/filter-bar";
import { MergeBeadsDialog } from "@/components/merge-beads-dialog";
import { OrchestrationView } from "@/components/orchestration-view";
import { ExistingOrchestrationsView } from "@/components/existing-orchestrations-view";
import { FinalCutView } from "@/components/final-cut-view";
import { BreakdownView } from "@/components/breakdown-view";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";

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
  const detailBeadId = searchParams.get("bead");
  const detailRepo = searchParams.get("detailRepo") ?? undefined;
  const viewParam = searchParams.get("view");
  const beadsView: "list" | "orchestration" | "existing" | "finalcut" | "breakdown" =
    viewParam === "orchestration"
      ? "orchestration"
      : viewParam === "existing"
        ? "existing"
        : viewParam === "finalcut"
          ? "finalcut"
          : viewParam === "breakdown"
            ? "breakdown"
            : "list";
  const isOrchestrationView = beadsView === "orchestration";
  const isExistingOrchestrationView = beadsView === "existing";
  const isListView = beadsView === "list";
  const isFinalCutView = beadsView === "finalcut";
  const isBreakdownView = beadsView === "breakdown";
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeBeadIds, setMergeBeadIds] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { filters, activeRepo, registeredRepos, setRegisteredRepos } =
    useAppStore();
  const {
    terminals,
    setActiveSession,
    upsertTerminal,
    updateStatus,
  } = useTerminalStore();
  const shippingByBeadId = terminals.reduce<Record<string, string>>(
    (acc, terminal) => {
      if (terminal.status === "running") {
        if (terminal.beadIds && terminal.beadIds.length > 0) {
          for (const bid of terminal.beadIds) {
            acc[bid] = terminal.sessionId;
          }
        } else {
          acc[terminal.beadId] = terminal.sessionId;
        }
      }
      return acc;
    },
    {}
  );

  const { data: registryData } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
  });

  useEffect(() => {
    if (registryData?.ok && registryData.data) {
      setRegisteredRepos(registryData.data);
    }
  }, [registryData, setRegisteredRepos]);

  const isReadyFilter = filters.status === "ready";
  const params: Record<string, string> = {};
  if (filters.status && !isReadyFilter) params.status = filters.status;
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
          result.data = result.data.map((bead) => ({
            ...bead,
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
            return result.data.map((bead) => ({
              ...bead,
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

  const beads = useMemo<Bead[]>(() => (data?.ok ? (data.data ?? []) : []), [data]);
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
    mutationFn: async ({ ids, fields }: { ids: string[]; fields: UpdateBeadInput }) => {
      await Promise.all(
        ids.map((id) => {
          const bead = beads.find((b) => b.id === id) as unknown as Record<string, unknown>;
          const repo = bead?._repoPath as string | undefined;
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
    (fields: UpdateBeadInput) => {
      if (selectedIds.length > 0) {
        bulkUpdate({ ids: selectedIds, fields });
      }
    },
    [selectedIds, bulkUpdate]
  );

  const handleClearSelection = useCallback(() => {
    setSelectionVersion((v) => v + 1);
  }, []);

  const handleShipBead = useCallback(
    async (bead: Bead) => {
      const existingRunning = terminals.find(
        (terminal) => terminal.beadId === bead.id && terminal.status === "running"
      );
      if (existingRunning) {
        setActiveSession(existingRunning.sessionId);
        toast.info("Opened active session");
        return;
      }

      const repo = (bead as unknown as Record<string, unknown>)._repoPath as string | undefined;
      const result = await startSession(bead.id, repo ?? activeRepo ?? undefined);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "Failed to start terminal session");
        return;
      }
      upsertTerminal({
        sessionId: result.data.id,
        beadId: bead.id,
        beadTitle: bead.title,
        repoPath: result.data.repoPath ?? repo ?? activeRepo ?? undefined,
        status: "running",
        startedAt: new Date().toISOString(),
      });
    },
    [activeRepo, setActiveSession, terminals, upsertTerminal]
  );

  const handleAbortShipping = useCallback(async (beadId: string) => {
    const running = terminals.find(
      (terminal) =>
        terminal.status === "running" &&
        (terminal.beadId === beadId ||
         (terminal.beadIds && terminal.beadIds.includes(beadId)))
    );
    if (!running) return;

    const result = await abortSession(running.sessionId);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to terminate session");
      return;
    }
    updateStatus(running.sessionId, "aborted");
    toast.success(running.beadIds ? "Scene terminated" : "Take terminated");
  }, [terminals, updateStatus]);

  const handleSceneBeads = useCallback(
    async (ids: string[]) => {
      const firstBead = beads.find((b) => ids.includes(b.id));
      const repo = (firstBead as unknown as Record<string, unknown>)?._repoPath as string | undefined;

      const result = await startSceneSession(ids, repo ?? activeRepo ?? undefined);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "Failed to start scene session");
        return;
      }
      upsertTerminal({
        sessionId: result.data.id,
        beadId: result.data.beadId,
        beadTitle: result.data.beadTitle,
        beadIds: result.data.beadIds,
        repoPath: result.data.repoPath ?? repo ?? activeRepo ?? undefined,
        status: "running",
        startedAt: new Date().toISOString(),
      });
    },
    [beads, activeRepo, upsertTerminal]
  );

  const handleMergeBeads = useCallback(
    (ids: string[]) => {
      setMergeBeadIds(ids);
      setMergeDialogOpen(true);
    },
    []
  );

  const handleMergeComplete = useCallback(() => {
    setSelectionVersion((v) => v + 1);
  }, []);

  const setBeadDetailParams = useCallback((id: string | null, repo: string | undefined, mode: "push" | "replace") => {
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

  const handleOpenBead = useCallback((bead: Bead) => {
    const repo = (bead as unknown as Record<string, unknown>)._repoPath as string | undefined;
    setBeadDetailParams(bead.id, repo, "push");
  }, [setBeadDetailParams]);

  const handleBeadLightboxOpenChange = useCallback((open: boolean) => {
    if (!open) setBeadDetailParams(null, undefined, "replace");
  }, [setBeadDetailParams]);

  const handleMovedBead = useCallback((newId: string, targetRepo: string) => {
    setBeadDetailParams(newId, targetRepo, "replace");
    queryClient.invalidateQueries({ queryKey: ["beads"] });
  }, [queryClient, setBeadDetailParams]);

  const initialDetailBead = useMemo(() => {
    if (!detailBeadId) return null;
    return beads.find((bead) => {
      if (bead.id !== detailBeadId) return false;
      const beadRepo = (bead as unknown as Record<string, unknown>)._repoPath as string | undefined;
      return !detailRepo || beadRepo === detailRepo;
    }) ?? null;
  }, [beads, detailBeadId, detailRepo]);

  return (
    <div className="mx-auto max-w-[95vw] overflow-hidden px-4 pt-2">
      {(isListView || isFinalCutView) && (
        <div className="mb-2 flex h-10 items-center border-b border-border/60 pb-2">
          {isListView && (
            <FilterBar
              selectedIds={selectedIds}
              onBulkUpdate={handleBulkUpdate}
              onClearSelection={handleClearSelection}
              onSceneBeads={handleSceneBeads}
              onMergeBeads={handleMergeBeads}
            />
          )}
        </div>
      )}

      <div className="mt-0.5">
        <div className={isOrchestrationView ? "" : "hidden"}>
          <OrchestrationView
            onApplied={() => {
              queryClient.invalidateQueries({ queryKey: ["beads"] });
            }}
          />
        </div>
        <div className={isExistingOrchestrationView ? "" : "hidden"}>
          <ExistingOrchestrationsView />
        </div>
        <div className={isFinalCutView ? "" : "hidden"}>
          <FinalCutView />
        </div>
        <div className={isBreakdownView ? "" : "hidden"}>
          <BreakdownView />
        </div>
        <div className={isListView ? "overflow-x-auto" : "hidden"}>
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
              <BeadTable
                data={beads}
                showRepoColumn={showRepoColumn}
                onSelectionChange={handleSelectionChange}
                selectionVersion={selectionVersion}
                searchQuery={searchQuery}
                onOpenBead={handleOpenBead}
                onShipBead={handleShipBead}
                shippingByBeadId={shippingByBeadId}
                onAbortShipping={handleAbortShipping}
              />
            </>
          )}
        </div>
      </div>
      <BeadDetailLightbox
        key={`${detailBeadId ?? "none"}:${detailRepo ?? "none"}`}
        open={Boolean(detailBeadId)}
        beadId={detailBeadId}
        repo={detailRepo}
        initialBead={initialDetailBead}
        onOpenChange={handleBeadLightboxOpenChange}
        onMoved={handleMovedBead}
      />
      <MergeBeadsDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        beads={beads.filter((b) => mergeBeadIds.includes(b.id))}
        onMerged={handleMergeComplete}
      />
    </div>
  );
}
