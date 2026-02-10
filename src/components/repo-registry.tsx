"use client";

import { useState } from "react";
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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export function RepoRegistry() {
  const [browseOpen, setBrowseOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
  });

  const repos = data?.ok ? (data.data ?? []) : [];

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
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Repositories</h2>
          <p className="text-muted-foreground mt-1">
            Manage your registered beads repositories
          </p>
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
              directories that contain a .beads/ folder.
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
                    <CardTitle className="text-base truncate">
                      {repo.name}
                    </CardTitle>
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
