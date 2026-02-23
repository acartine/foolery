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
import { getIssueTrackerLabel, listKnownIssueTrackers } from "@/lib/issue-trackers";

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

  function invalidateRegistryAndBeads() {
    queryClient.invalidateQueries({ queryKey: ["registry"] });
    queryClient.invalidateQueries({ queryKey: ["beads"] });
  }

  async function handleAdd(path: string) {
    const result = await addRepoToRegistry(path);
    if (result.ok) {
      toast.success(`Added ${path}`);
      invalidateRegistryAndBeads();
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
      invalidateRegistryAndBeads();
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
        <h3 className="text-sm font-medium">Repositories</h3>
        <Button size="sm" variant="outline" onClick={() => setBrowseOpen(true)}>
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
  const supported = listKnownIssueTrackers()
    .map((tracker) => tracker.type)
    .join(", ");

  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-8 text-center">
      <Database className="size-8 text-muted-foreground mb-3" />
      <p className="text-sm font-medium mb-1">No repositories registered</p>
      <p className="text-xs text-muted-foreground mb-3 max-w-[260px]">
        Add a repository with a supported issue tracker ({supported}) to get
        started.
      </p>
      <Button size="sm" onClick={onBrowse}>
        <FolderOpen className="mr-1 h-3.5 w-3.5" />
        Browse
      </Button>
    </div>
  );
}

interface RepoListProps {
  repos: { path: string; name: string; trackerType?: string }[];
  onRemove: (path: string) => void;
}

function RepoList({ repos, onRemove }: RepoListProps) {
  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <div
          key={repo.path}
          className="flex items-center justify-between rounded-md border px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{repo.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tracker: {getIssueTrackerLabel(repo.trackerType)}
            </p>
            <p className="font-mono text-xs text-muted-foreground truncate">
              {repo.path}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(repo.path)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
