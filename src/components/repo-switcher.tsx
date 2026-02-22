"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Database } from "lucide-react";
import { fetchRegistry } from "@/lib/registry-api";
import { useAppStore, getPersistedRepo } from "@/stores/app-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function RepoSwitcher() {
  const { activeRepo, registeredRepos, setRegisteredRepos } =
    useAppStore();
  const updateUrl = useUpdateUrl();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data?.ok && data.data) {
      setRegisteredRepos(data.data);
      // Restore last selected repo, or default to first repo
      if (!activeRepo && data.data.length > 0) {
        const persisted = getPersistedRepo();
        const match = persisted && data.data.find((r) => r.path === persisted);
        updateUrl({ repo: match ? match.path : data.data[0].path });
      }
    }
  }, [data, setRegisteredRepos, activeRepo, updateUrl]);

  const currentName = activeRepo
    ? registeredRepos.find((r) => r.path === activeRepo)?.name ?? "Unknown"
    : "All Repositories";

  if (registeredRepos.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" title="Switch repository" className="h-8 gap-1.5 px-2.5">
          <Database className="size-4" />
          <span className="max-w-[180px] truncate">{currentName}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => updateUrl({ repo: null })}>
          <span className={!activeRepo ? "font-semibold" : ""}>
            All Repositories
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {registeredRepos.map((repo) => (
          <DropdownMenuItem
            key={repo.path}
            onClick={() => updateUrl({ repo: repo.path })}
          >
            <div className="min-w-0">
              <div
                className={`truncate ${activeRepo === repo.path ? "font-semibold" : ""}`}
              >
                {repo.name}
              </div>
              <div className="text-xs text-muted-foreground font-mono truncate">
                {repo.path}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("settings", "repos");
          router.push(`${pathname}?${params.toString()}`);
        }}>
          Manage Repositories...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
