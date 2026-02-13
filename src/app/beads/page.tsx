"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchBeads, fetchBeadsFromAllRepos, updateBead } from "@/lib/api";
import { startSession, abortSession } from "@/lib/terminal-api";
import { fetchRegistry } from "@/lib/registry-api";
import { BeadTable } from "@/components/bead-table";
import { FilterBar } from "@/components/filter-bar";
import { OrchestrationView } from "@/components/orchestration-view";
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
  const isOrchestrationView = searchParams.get("view") === "orchestration";
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const queryClient = useQueryClient();
  const { filters, activeRepo, registeredRepos, setRegisteredRepos } =
    useAppStore();
  const { setActiveTerminal, activeTerminal, updateStatus } = useTerminalStore();
  const isShippingLocked = activeTerminal?.status === "running";
  const shippingBeadId = isShippingLocked ? activeTerminal.beadId : undefined;

  const { data: registryData } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
  });

  useEffect(() => {
    if (registryData?.ok && registryData.data) {
      setRegisteredRepos(registryData.data);
    }
  }, [registryData, setRegisteredRepos]);

  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) params.priority = String(filters.priority);
  if (searchQuery) params.q = searchQuery;

  const { data, isLoading } = useQuery({
    queryKey: ["beads", params, activeRepo],
    queryFn: async () => {
      if (activeRepo) {
        const result = await fetchBeads(params, activeRepo);
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
      return fetchBeads(params);
    },
    enabled: !isOrchestrationView,
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
      if (isShippingLocked && shippingBeadId !== bead.id) {
        toast.error("A ship is already in progress");
        return;
      }
      const repo = (bead as unknown as Record<string, unknown>)._repoPath as string | undefined;
      const result = await startSession(bead.id, repo ?? activeRepo ?? undefined);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "Failed to start terminal session");
        return;
      }
      setActiveTerminal({
        sessionId: result.data.id,
        beadId: bead.id,
        beadTitle: bead.title,
        status: "running",
      });
    },
    [activeRepo, isShippingLocked, setActiveTerminal, shippingBeadId]
  );

  const handleAbortShipping = useCallback(async () => {
    if (!activeTerminal) return;
    const result = await abortSession(activeTerminal.sessionId);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to terminate ship");
      return;
    }
    updateStatus("aborted");
    toast.success("Ship terminated");
  }, [activeTerminal, updateStatus]);

  return (
    <div className="mx-auto max-w-[95vw] overflow-hidden px-4 pt-2">
      {!isOrchestrationView && (
        <div className="mb-2 flex min-h-9 items-center border-b border-border/60 pb-2">
          <FilterBar
            selectedIds={selectedIds}
            onBulkUpdate={handleBulkUpdate}
            onClearSelection={handleClearSelection}
          />
        </div>
      )}

      <div className={isOrchestrationView ? "mt-0.5" : "mt-0.5 overflow-x-auto"}>
        {isOrchestrationView ? (
          <OrchestrationView
            onApplied={() => {
              queryClient.invalidateQueries({ queryKey: ["beads"] });
            }}
          />
        ) : isLoading ? (
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
            isShippingLocked={isShippingLocked}
            shippingBeadId={shippingBeadId}
            onAbortShipping={handleAbortShipping}
          />
        )}
      </div>
    </div>
  );
}
