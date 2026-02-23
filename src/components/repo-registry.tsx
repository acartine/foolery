"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderOpen, Plus, Trash2, Database, CircleDot } from "lucide-react";
import { toast } from "sonner";
import {
  fetchRegistry,
  addRepoToRegistry,
  removeRepoFromRegistry,
} from "@/lib/registry-api";
import { DirectoryBrowser } from "@/components/directory-browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getIssueTrackerLabel, listKnownIssueTrackers } from "@/lib/issue-trackers";

function TrackerBadge({ type }: { type?: string }) {
  const label = getIssueTrackerLabel(type);
  const isKnown = type && label !== "Unknown";
  return (
    <span
      className={
        isKnown
          ? "inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400 px-2 py-0.5 rounded-full shrink-0"
          : "inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0"
      }
    >
      <CircleDot className="size-3" />
      {label}
    </span>
  );
}

export function RepoRegistry() {
  const [browseOpen, setBrowseOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const repos = data?.ok ? (data.data ?? []) : [];
  const supported = listKnownIssueTrackers()
    .map((tracker) => tracker.type)
    .join(", ");

  async function handleAdd(path: string) {
    const result = await addRepoToRegistry(path);
    if (result.ok) {
      toast.success(`Added ${path}`);
      queryClient.invalidateQueries({ queryKey: ["registry"] });
    } else {
      toast.error(result.error ?? "Failed to add repository");
    }
  }

  async function handleRemove(path: string) {
    if (!confirm(`Remove ${path} from registry?`)) return;
    const result = await removeRepoFromRegistry(path);
    if (result.ok) {
      toast.success("Repository removed");
      queryClient.invalidateQueries({ queryKey: ["registry"] });
    } else {
      toast.error(result.error ?? "Failed to remove repository");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading registry...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/beads"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Repositories</h2>
            <p className="text-muted-foreground mt-1">
              Manage your registered repositories and their issue trackers
            </p>
          </div>
        </div>
        <Button onClick={() => setBrowseOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Repository
        </Button>
      </div>

      {repos.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="size-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              No repositories registered
            </h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Add a repository to get started. Browse your filesystem to find
              directories with supported issue trackers ({supported}).
            </p>
            <Button onClick={() => setBrowseOpen(true)}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Browse for Repository
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {repos.map((repo) => (
            <Card key={repo.path}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base truncate">
                        {repo.name}
                      </CardTitle>
                      <TrackerBadge type={repo.trackerType} />
                    </div>
                    <CardDescription className="font-mono text-xs mt-1 truncate">
                      {repo.path}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(repo.path)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <DirectoryBrowser
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        onSelect={handleAdd}
      />
    </div>
  );
}
