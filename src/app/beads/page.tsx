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
import { OrchestrationView } from "@/components/orchestration-view";
import { ExistingOrchestrationsView } from "@/components/existing-orchestrations-view";
import { FinalCutView } from "@/components/final-cut-view";
import { BreakdownView } from "@/components/breakdown-view";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { toast } from "sonner";
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";

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

  const { data, isLoading } = useQuery({
    queryKey: ["beads", params, activeRepo, isReadyFilter],
    queryFn: async () => {
      const fetcher = isReadyFilter ? fetchReadyBeads : fetchBeads;
      if (activeRepo) {
        const result = await fetcher(params, activeRepo);
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
        const results = await Promise.all(
          registeredRepos.map(async (repo) => {
            const result = await fetcher(params, repo.path);
            if (!result.ok || !result.data) return [];
            return result.data.map((bead) => ({
              ...bead,
              _repoPath: repo.path,
              _repoName: repo.name,
            }));
          })
        );
        return { ok: true, data: results.flat() };
      }
      return fetcher(params);
    },
    enabled: isListView,
    refetchInterval: 10_000,
  });

  const beads = useMemo<Bead[]>(() => (data?.ok ? (data.data ?? []) : []), [data]);
  const loadError = data && !data.ok ? data.error ?? "Failed to load beats." : null;
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
        status: "running",
        startedAt: new Date().toISOString(),
      });
    },
    [beads, activeRepo, upsertTerminal]
  );

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
      {isListView && (
        <div className="mb-2 flex min-h-9 items-center border-b border-border/60 pb-2">
          <FilterBar
            selectedIds={selectedIds}
            onBulkUpdate={handleBulkUpdate}
            onClearSelection={handleClearSelection}
            onSceneBeads={handleSceneBeads}
          />
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
          ) : loadError ? (
            <div className="flex items-center justify-center py-6 text-sm text-destructive">
              Failed to load beats: {loadError}
            </div>
          ) : (
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
    </div>
  );
}
