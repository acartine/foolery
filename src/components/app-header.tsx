"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Clapperboard, List, Film, Scissors, Settings, PartyPopper } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { RepoSwitcher } from "@/components/repo-switcher";
import { SearchBar } from "@/components/search-bar";
import { CreateBeadDialog } from "@/components/create-bead-dialog";
import { SettingsSheet } from "@/components/settings-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/app-store";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBeadsRoute =
    pathname === "/beads" || pathname.startsWith("/beads/");
  const viewParam = searchParams.get("view");
  const beadsView: "list" | "orchestration" | "existing" | "finalcut" =
    viewParam === "orchestration"
      ? "orchestration"
      : viewParam === "existing"
        ? "existing"
        : viewParam === "finalcut"
          ? "finalcut"
          : "list";
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { activeRepo, registeredRepos } = useAppStore();

  const canCreate = Boolean(activeRepo) || registeredRepos.length > 0;
  const shouldChooseRepo = !activeRepo && registeredRepos.length > 1;
  const defaultRepo = useMemo(
    () => activeRepo ?? registeredRepos[0]?.path ?? null,
    [activeRepo, registeredRepos]
  );

  useEffect(() => {
    if (!isBeadsRoute || !canCreate) return;
    // Shift+N only opens create dialog on Beats list view
    if (beadsView !== "list") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "N" && e.shiftKey) {
        if (document.querySelector('[role="dialog"]')) return;
        const target = e.target as HTMLElement;
        if (
          target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.tagName === "SELECT"
        ) {
          return;
        }
        e.preventDefault();
        setSelectedRepo(defaultRepo);
        setCreateOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [beadsView, canCreate, defaultRepo, isBeadsRoute]);

  const openCreateDialog = (repo: string | null) => {
    setSelectedRepo(repo);
    setCreateOpen(true);
  };

  const setBeadsView = useCallback((view: "list" | "orchestration" | "existing" | "finalcut") => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "list") params.delete("view");
    else params.set("view", view);
    const qs = params.toString();
    router.push(`/beads${qs ? `?${qs}` : ""}`);
  }, [searchParams, router]);

  // Shift+] / Shift+[ to cycle views
  useEffect(() => {
    if (!isBeadsRoute) return;
    const views: ("list" | "orchestration" | "existing" | "finalcut")[] = ["list", "existing", "orchestration", "finalcut"];
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT") return;

      if ((e.key === "}" || e.key === "]") && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const idx = views.indexOf(beadsView);
        setBeadsView(views[(idx + 1) % views.length]);
      } else if ((e.key === "{" || e.key === "[") && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const idx = views.indexOf(beadsView);
        setBeadsView(views[(idx - 1 + views.length) % views.length]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBeadsRoute, beadsView, setBeadsView]);

  // Button config changes per view: hidden on Direct/Scenes, "Wrap!" on Final Cut, "Add" on Beats
  const showActionButton = beadsView === "list" || beadsView === "finalcut";

  const actionButton = (() => {
    if (beadsView === "finalcut") {
      // Final Cut: celebratory "Wrap!" button — no create dialog, just a visual cue
      return (
        <Button
          size="lg"
          variant="success"
          className="gap-1.5 px-2.5"
          title="That's a wrap!"
        >
          <PartyPopper className="size-4" />
          Wrap!
        </Button>
      );
    }

    // Beats list: original Add / New behavior
    if (shouldChooseRepo) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="lg" variant="success" className="gap-1.5 px-2.5" title="Create new beat (Shift+N)">
              <Plus className="size-4" />
              New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {registeredRepos.map((repo) => (
              <DropdownMenuItem
                key={repo.path}
                onClick={() => openCreateDialog(repo.path)}
              >
                {repo.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <Button
        size="lg"
        variant="success"
        className="gap-1.5 px-2.5"
        title="Create new beat (Shift+N)"
        onClick={() => openCreateDialog(defaultRepo)}
      >
        <Plus className="size-4" />
        Add
      </Button>
    );
  })();

  return (
    <>
      <header className="border-b border-border/70 bg-background/95 supports-[backdrop-filter]:bg-background/90 supports-[backdrop-filter]:backdrop-blur">
        <div className="mx-auto max-w-[95vw] px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              <Link href="/beads" title="Home" className="flex shrink-0 items-center gap-2">
                <Image
                  src="/foolery_icon.png"
                  alt="Foolery"
                  width={152}
                  height={49}
                  unoptimized
                  className="rounded-md"
                />
              </Link>
              <RepoSwitcher />
            </div>

            <SearchBar
              className="order-3 mx-0 basis-full md:order-none md:basis-auto md:flex-1 md:max-w-none"
              inputClassName="h-8"
              placeholder="Search beats..."
            />

            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              title="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" />
            </Button>

            {isBeadsRoute ? (
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border bg-muted/20 p-1">
                  <Button
                    size="lg"
                    variant={beadsView === "list" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    title="Beat list view"
                    onClick={() => setBeadsView("list")}
                  >
                    <List className="size-4" />
                    Beats
                  </Button>
                  <Button
                    size="lg"
                    variant={beadsView === "existing" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    disabled={!activeRepo}
                    title={!activeRepo ? "Select a repository to browse scenes" : "Existing scene trees"}
                    onClick={() => setBeadsView("existing")}
                  >
                    <Film className="size-4" />
                    Scenes
                  </Button>
                  <Button
                    size="lg"
                    variant={beadsView === "orchestration" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    disabled={!activeRepo}
                    title={!activeRepo ? "Select a repository to direct" : "Direction planner"}
                    onClick={() => setBeadsView("orchestration")}
                  >
                    <Clapperboard className="size-4" />
                    Direct
                  </Button>
                  <Button
                    size="lg"
                    variant={beadsView === "finalcut" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    title="Verification queue"
                    onClick={() => setBeadsView("finalcut")}
                  >
                    <Scissors className="size-4" />
                    Final Cut
                  </Button>
                </div>
                {canCreate && showActionButton ? (
                  actionButton
                ) : canCreate ? (
                  // Invisible placeholder preserves layout so the view switcher doesn't shift
                  <div className="invisible" aria-hidden="true">
                    <Button size="lg" variant="success" className="gap-1.5 px-2.5" tabIndex={-1}>
                      <Plus className="size-4" />
                      Add
                    </Button>
                  </div>
                ) : (
                  <Button size="lg" variant="outline" asChild title="Register a repository">
                    <Link href="/registry">Add Repo</Link>
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {isBeadsRoute ? (
        <CreateBeadDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            setCreateOpen(false);
            setSelectedRepo(null);
            queryClient.invalidateQueries({ queryKey: ["beads"] });
          }}
          repo={selectedRepo ?? activeRepo}
        />
      ) : null}

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
