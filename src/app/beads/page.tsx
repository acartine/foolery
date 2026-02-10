"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { fetchBeads } from "@/lib/api";
import { BeadTable } from "@/components/bead-table";
import { FilterBar } from "@/components/filter-bar";
import { CreateBeadDialog } from "@/components/create-bead-dialog";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";

export default function BeadsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { commandPaletteOpen, toggleCommandPalette, filters } = useAppStore();

  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) params.priority = String(filters.priority);
  if (filters.assignee) params.assignee = filters.assignee;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["beads", params],
    queryFn: () => fetchBeads(params),
  });

  const beads = data?.ok ? (data.data ?? []) : [];

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Beads</h1>
          <p className="text-muted-foreground mt-1">
            Manage your issues and tasks
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Bead
        </Button>
      </div>

      <FilterBar />

      <div className="mt-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading beads...
          </div>
        ) : (
          <BeadTable data={beads} />
        )}
      </div>

      <CreateBeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          refetch();
        }}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={toggleCommandPalette}
      />
    </div>
  );
}
