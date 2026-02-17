"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBeads } from "@/lib/api";
import { startSession } from "@/lib/terminal-api";
import { BeadTable } from "@/components/bead-table";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useVerificationNotifications } from "@/hooks/use-verification-notifications";
import { toast } from "sonner";
import type { Bead } from "@/lib/types";

export function FinalCutView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const { terminals, setActiveSession, upsertTerminal } = useTerminalStore();
  const [selectionVersion, setSelectionVersion] = useState(0);

  const shippingByBeadId = terminals.reduce<Record<string, string>>(
    (acc, terminal) => {
      if (terminal.status === "running") {
        if (terminal.beadIds && terminal.beadIds.length > 0) {
          for (const bid of terminal.beadIds) acc[bid] = terminal.sessionId;
        } else {
          acc[terminal.beadId] = terminal.sessionId;
        }
      }
      return acc;
    },
    {}
  );

  const { data, isLoading } = useQuery({
    queryKey: ["beads", "finalcut", activeRepo],
    queryFn: async () => {
      const params: Record<string, string> = { status: "in_progress" };
      if (activeRepo) {
        const result = await fetchBeads(params, activeRepo);
        if (result.ok && result.data) {
          const repo = registeredRepos.find((r) => r.path === activeRepo);
          result.data = result.data
            .filter((b) => b.labels?.includes("stage:verification"))
            .map((bead) => ({
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
            const result = await fetchBeads(params, repo.path);
            if (!result.ok || !result.data) return [];
            return result.data
              .filter((b) => b.labels?.includes("stage:verification"))
              .map((bead) => ({
                ...bead,
                _repoPath: repo.path,
                _repoName: repo.name,
              }));
          })
        );
        return { ok: true, data: results.flat() };
      }
      const result = await fetchBeads(params);
      if (result.ok && result.data) {
        result.data = result.data.filter((b) => b.labels?.includes("stage:verification"));
      }
      return result;
    },
    refetchInterval: 10_000,
  });

  const beads: Bead[] = data?.ok ? (data.data ?? []) : [];
  useVerificationNotifications(beads);
  const showRepoColumn = !activeRepo && registeredRepos.length > 1;

  const handleSelectionChange = useCallback((ids: string[]) => {
    // selection tracked for potential bulk actions
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

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 border-b border-border/60 pb-2">
        <span className="text-sm text-muted-foreground">
          {beads.length} beat{beads.length !== 1 ? "s" : ""} awaiting verification
        </span>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          Loading final cut...
        </div>
      ) : (
        <BeadTable
          data={beads}
          showRepoColumn={showRepoColumn}
          onSelectionChange={handleSelectionChange}
          selectionVersion={selectionVersion}
          onShipBead={handleShipBead}
          shippingByBeadId={shippingByBeadId}
        />
      )}
    </div>
  );
}
