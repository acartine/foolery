"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { fetchBeads, fetchBeadsFromAllRepos } from "@/lib/api";
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
import type { Bead } from "@/lib/types";

export default function BeadsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
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

  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) params.priority = String(filters.priority);
  if (filters.assignee) params.assignee = filters.assignee;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["beads", params, activeRepo],
    queryFn: () => {
      if (activeRepo) {
        return fetchBeads(params, activeRepo);
      }
      if (registeredRepos.length > 0) {
        return fetchBeadsFromAllRepos(registeredRepos, params);
      }
      return fetchBeads(params);
    },
  });

  const beads: Bead[] = data?.ok ? (data.data ?? []) : [];

  const showRepoColumn = !activeRepo && registeredRepos.length > 1;

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {activeRepo
              ? (registeredRepos.find((r) => r.path === activeRepo)?.name ?? "Beads")
              : "Beads"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your issues and tasks
          </p>
        </div>
        {!activeRepo && registeredRepos.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Bead
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
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Bead
          </Button>
        )}
      </div>

      <FilterBar />

      <div className="mt-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading beads...
          </div>
        ) : (
          <BeadTable data={beads} showRepoColumn={showRepoColumn} />
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
