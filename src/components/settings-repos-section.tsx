"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, Trash2, Database } from "lucide-react";
import { toast } from "sonner";
import {
  fetchRegistry,
  addRepoToRegistry,
  removeRepoFromRegistry,
} from "@/lib/registry-api";
import { DirectoryBrowser } from "@/components/directory-browser";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";
import { listKnownMemoryManagers } from "@/lib/memory-managers";
import { MemoryManagerBadge } from "@/components/memory-manager-badge";

export function SettingsReposSection() {
  const [browseOpen, setBrowseOpen] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeRepo, setActiveRepo } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const repos = data?.ok ? (data.data ?? []) : [];

  function invalidateRegistryAndBeats() {
    queryClient.invalidateQueries({ queryKey: ["registry"] });
    queryClient.invalidateQueries({ queryKey: ["beats"] });
  }

  async function handleAdd(path: string) {
    const result = await addRepoToRegistry(path);
    if (result.ok) {
      toast.success(`Added ${path}`);
      invalidateRegistryAndBeats();
    } else {
      toast.error(result.error ?? "Failed to add repository");
    }
  }

  async function handleRemove(path: string) {
    if (!confirm(`Remove ${path} from registry?`)) return;
    const result = await removeRepoFromRegistry(path);
    if (result.ok) {
      toast.success("Repository removed");
      if (activeRepo === path) {
        setActiveRepo(null);
        clearRepoUrlParam();
      }
      invalidateRegistryAndBeats();
    } else {
      toast.error(result.error ?? "Failed to remove repository");
    }
  }

  function clearRepoUrlParam() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("repo");
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-4 text-primary drop-shadow-[0_0_8px_rgba(137,87,255,0.45)]" />
          <h3 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-sm font-medium text-transparent">
            Repositories
          </h3>
          <span className="rounded-full border border-accent/55 bg-gradient-to-r from-primary/34 to-accent/34 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Ready
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-accent/65 bg-gradient-to-r from-accent/30 via-accent/20 to-primary/28 shadow-sm shadow-accent/25 hover:from-accent/40 hover:to-primary/36"
          onClick={() => setBrowseOpen(true)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : repos.length === 0 ? (
        <EmptyReposState onBrowse={() => setBrowseOpen(true)} />
      ) : (
        <RepoList repos={repos} onRemove={handleRemove} />
      )}

      <DirectoryBrowser
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        onSelect={handleAdd}
      />
    </div>
  );
}

function EmptyReposState({ onBrowse }: { onBrowse: () => void }) {
  const supported = listKnownMemoryManagers()
    .map((memoryManager) => memoryManager.type)
    .join(", ");

  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-primary/70 bg-gradient-to-br from-primary/34 via-primary/12 to-accent/30 py-8 text-center shadow-md shadow-primary/20 ring-1 ring-primary/25">
      <div className="pointer-events-none absolute -top-12 -right-8 h-28 w-28 rounded-full bg-primary/35 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-accent/30 blur-2xl" />
      <Database className="mb-3 size-8 text-primary drop-shadow-[0_0_12px_rgba(137,87,255,0.45)]" />
      <p className="text-sm font-medium mb-1">No repositories registered</p>
      <p className="text-xs text-muted-foreground mb-3 max-w-[260px]">
        Add a repository with a supported memory manager ({supported}) to get
        started.
      </p>
      <Button
        size="sm"
        className="bg-gradient-to-r from-primary via-primary to-accent text-primary-foreground shadow-md shadow-primary/35 hover:brightness-105"
        onClick={onBrowse}
      >
        <FolderOpen className="mr-1 h-3.5 w-3.5" />
        Browse
      </Button>
    </div>
  );
}

interface RepoListProps {
  repos: { path: string; name: string; memoryManagerType?: string }[];
  onRemove: (path: string) => void;
}

function RepoList({ repos, onRemove }: RepoListProps) {
  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <div
          key={repo.path}
          className="group relative flex items-center justify-between overflow-hidden rounded-lg border border-primary/50 bg-gradient-to-r from-primary/26 via-primary/10 to-accent/24 px-3 py-2 transition-all hover:-translate-y-0.5 hover:border-accent/65 hover:from-primary/34 hover:to-accent/32 hover:shadow-sm hover:shadow-accent/20"
        >
          <div className="pointer-events-none absolute -right-8 -top-8 h-16 w-16 rounded-full bg-primary/35 blur-xl" />
          <div className="pointer-events-none absolute -left-6 -bottom-6 h-14 w-14 rounded-full bg-accent/30 blur-xl" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-gradient-to-r from-primary to-accent shadow-sm" />
              <p className="text-sm font-medium truncate">{repo.name}</p>
              <MemoryManagerBadge type={repo.memoryManagerType} />
            </div>
            <p className="font-mono text-xs text-muted-foreground truncate">
              {repo.path}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 border border-transparent text-muted-foreground hover:border-primary/45 hover:bg-primary/18 hover:text-accent"
            onClick={() => onRemove(repo.path)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
