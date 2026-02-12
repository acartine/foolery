"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Database } from "lucide-react";
import { fetchRegistry } from "@/lib/registry-api";
import { useAppStore } from "@/stores/app-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function RepoSwitcher() {
  const { activeRepo, setActiveRepo, registeredRepos, setRegisteredRepos } =
    useAppStore();

  const { data } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
  });

  useEffect(() => {
    if (data?.ok && data.data) {
      setRegisteredRepos(data.data);
    }
  }, [data, setRegisteredRepos]);

  const currentName = activeRepo
    ? registeredRepos.find((r) => r.path === activeRepo)?.name ?? "Unknown"
    : "All Repositories";

  if (registeredRepos.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="h-8 gap-1.5 px-2.5">
          <Database className="size-4" />
          <span className="max-w-[180px] truncate">{currentName}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => setActiveRepo(null)}>
          <span className={!activeRepo ? "font-semibold" : ""}>
            All Repositories
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {registeredRepos.map((repo) => (
          <DropdownMenuItem
            key={repo.path}
            onClick={() => setActiveRepo(repo.path)}
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
        <DropdownMenuItem asChild>
          <Link href="/registry" className="w-full">
            Manage Repositories...
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
