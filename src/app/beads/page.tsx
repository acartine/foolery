"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { fetchBeads, fetchBeadsFromAllRepos, updateBead } from "@/lib/api";
import { fetchRegistry } from "@/lib/registry-api";
import { BeadTable } from "@/components/bead-table";
import { FilterBar } from "@/components/filter-bar";
import { CreateBeadDialog } from "@/components/create-bead-dialog";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/app-store";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const queryClient = useQueryClient();
  const {
    commandPaletteOpen,
    toggleCommandPalette,
    filters,
    activeRepo,
    registeredRepos,
    setRegisteredRepos,
  } = useAppStore();

  const { data: registryData } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
  });

  useEffect(() => {
    if (registryData?.ok && registryData.data) {
      setRegisteredRepos(registryData.data);
    }
  }, [registryData, setRegisteredRepos]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "N" && e.shiftKey) {
        // Don't open if already in a dialog or input
        if (document.querySelector('[role="dialog"]')) return;
        const target = e.target as HTMLElement;
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT") return;
        e.preventDefault();
        setCreateOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) params.priority = String(filters.priority);
  if (searchQuery) params.q = searchQuery;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["beads", params, activeRepo],
    queryFn: () => {
      if (activeRepo) return fetchBeads(params, activeRepo);
      if (registeredRepos.length > 0) return fetchBeadsFromAllRepos(registeredRepos, params);
      return fetchBeads(params);
    },
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

  const newBeadButton = !activeRepo && registeredRepos.length > 0 ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="success" className="justify-center">
          <Plus className="mr-2 h-4 w-4" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {registeredRepos.map((repo) => (
          <DropdownMenuItem
            key={repo.path}
            onClick={() => {
              setSelectedRepo(repo.path);
              setCreateOpen(true);
            }}
          >
            {repo.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <Button size="sm" variant="success" className="justify-center" onClick={() => setCreateOpen(true)}>
      <Plus className="mr-2 h-4 w-4" />
      New
    </Button>
  );

  return (
    <div className="container mx-auto pt-1 px-1 max-w-7xl">
      <div className="flex items-center justify-end gap-2 mb-1">
        <FilterBar
          selectedIds={selectedIds}
          onBulkUpdate={handleBulkUpdate}
          onClearSelection={handleClearSelection}
        />
        {newBeadButton}
      </div>

      <div className="mt-0.5">
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
          />
        )}
      </div>

      <CreateBeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          setSelectedRepo(null);
          refetch();
        }}
        repo={selectedRepo ?? activeRepo}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={toggleCommandPalette}
      />
    </div>
  );
}
