"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBeads, fetchBeadsFromAllRepos, fetchReadyBeads, updateBead } from "@/lib/api";
import { startSession, abortSession } from "@/lib/terminal-api";
import { fetchRegistry } from "@/lib/registry-api";
import { BeadTable } from "@/components/bead-table";
import { FilterBar } from "@/components/filter-bar";
import { OrchestrationView } from "@/components/orchestration-view";
import { ExistingOrchestrationsView } from "@/components/existing-orchestrations-view";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { toast } from "sonner";
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";

export default function BeadsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-6 text-muted-foreground">Loading beads...</div>}>
      <BeadsPageInner />
    </Suspense>
  );
}

function BeadsPageInner() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const viewParam = searchParams.get("view");
  const beadsView: "list" | "orchestration" | "existing" =
    viewParam === "orchestration"
      ? "orchestration"
      : viewParam === "existing"
        ? "existing"
        : "list";
  const isOrchestrationView = beadsView === "orchestration";
  const isExistingOrchestrationView = beadsView === "existing";
  const isListView = beadsView === "list";
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
        acc[terminal.beadId] = terminal.sessionId;
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
      if (registeredRepos.length > 0) return fetchBeadsFromAllRepos(registeredRepos, params);
      return fetcher(params);
    },
    enabled: isListView,
    refetchInterval: 10_000,
  });

  const beads: Bead[] = data?.ok ? (data.data ?? []) : [];
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
      toast.success("Beads updated");
    },
    onError: () => {
      toast.error("Failed to update beads");
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
        toast.info("Opened active ship terminal");
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
      (terminal) => terminal.beadId === beadId && terminal.status === "running"
    );
    if (!running) return;

    const result = await abortSession(running.sessionId);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to terminate ship");
      return;
    }
    updateStatus(running.sessionId, "aborted");
    toast.success("Ship terminated");
  }, [terminals, updateStatus]);

  return (
    <div className="mx-auto max-w-[95vw] overflow-hidden px-4 pt-2">
      {isListView && (
        <div className="mb-2 flex min-h-9 items-center border-b border-border/60 pb-2">
          <FilterBar
            selectedIds={selectedIds}
            onBulkUpdate={handleBulkUpdate}
            onClearSelection={handleClearSelection}
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
        <div className={isListView ? "overflow-x-auto" : "hidden"}>
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              Loading beads...
            </div>
          ) : (
            <BeadTable
              data={beads}
              showRepoColumn={showRepoColumn}
              onSelectionChange={handleSelectionChange}
              selectionVersion={selectionVersion}
              searchQuery={searchQuery}
              onShipBead={handleShipBead}
              shippingByBeadId={shippingByBeadId}
              onAbortShipping={handleAbortShipping}
            />
          )}
        </div>
      </div>
    </div>
  );
}
