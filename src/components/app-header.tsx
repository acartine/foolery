"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Scissors, RotateCcw, Settings, UserRoundCheck, X, History, PartyPopper, Zap, Inbox } from "lucide-react";
import Image from "next/image";
import { VersionBadge } from "@/components/version-badge";
import { RepoSwitcher } from "@/components/repo-switcher";
import { SearchBar } from "@/components/search-bar";
import { CreateBeatDialog } from "@/components/create-beat-dialog";
import { SettingsSheet } from "@/components/settings-sheet";
import { NotificationBell } from "@/components/notification-bell";
import { HotkeyHelp } from "@/components/hotkey-help";
import type { SettingsSection } from "@/components/settings-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import { useHumanActionCount } from "@/hooks/use-human-action-count";
import { buildBeatFocusHref } from "@/lib/beat-navigation";
import { parseBeatsView } from "@/lib/beats-view";
import {
  cycleRepoPath,
  getRepoCycleDirection,
  isHotkeyHelpToggleKey,
  readHotkeyHelpOpen,
  toggleHotkeyHelpOpen,
} from "@/lib/hotkey-help-state";

type VersionBanner = {
  installedVersion: string;
  latestVersion: string;
};

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBeatsRoute =
    pathname === "/beats" || pathname.startsWith("/beats/");
  const beatsView = parseBeatsView(searchParams.get("view"));
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createRepoMenuOpen, setCreateRepoMenuOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [hotkeyHelpOpen, setHotkeyHelpOpen] = useState(() =>
    readHotkeyHelpOpen(
      typeof window === "undefined" ? null : window.localStorage
    )
  );
  const settingsParam = searchParams.get("settings");
  const settingsOpenFromUrl = settingsParam === "repos";
  const [settingsOpen, setSettingsOpen] = useState(settingsOpenFromUrl);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    settingsOpenFromUrl ? "repos" : null
  );
  const [versionBanner, setVersionBanner] = useState<VersionBanner | null>(null);
  const [versionBannerDismissed, setVersionBannerDismissed] = useState(false);
  const { activeRepo, registeredRepos } = useAppStore();
  const toggleTerminalPanel = useTerminalStore((s) => s.togglePanel);
  const updateUrl = useUpdateUrl();
  const isFinalCutActive = beatsView === "finalcut";
  const humanActionCount = useHumanActionCount(isBeatsRoute, isFinalCutActive);
  const activeBeatId = searchParams.get("beat");

  // Derive settings sheet state from URL param — open when ?settings=repos is present
  const effectiveSettingsOpen = settingsOpen || settingsOpenFromUrl;
  const effectiveSettingsSection = settingsOpenFromUrl ? "repos" : settingsSection;

  const canCreate = Boolean(activeRepo) || registeredRepos.length > 0;
  const shouldChooseRepo = !activeRepo && registeredRepos.length > 1;
  const defaultRepo = useMemo(
    () => activeRepo ?? registeredRepos[0]?.path ?? null,
    [activeRepo, registeredRepos]
  );

  const openCreateDialog = useCallback((repo: string | null) => {
    setCreateRepoMenuOpen(false);
    setSelectedRepo(repo);
    setCreateOpen(true);
  }, []);

  const openCreateFlow = useCallback(() => {
    if (shouldChooseRepo) {
      setCreateRepoMenuOpen(true);
      return;
    }

    openCreateDialog(defaultRepo);
  }, [defaultRepo, openCreateDialog, shouldChooseRepo]);

  useEffect(() => {
    if (!isBeatsRoute || !canCreate) return;
    // Shift+N only opens create dialog on Beats list views (queues/active)
    if (beatsView !== "queues" && beatsView !== "active") return;
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
        openCreateFlow();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [beatsView, canCreate, isBeatsRoute, openCreateFlow]);

  useEffect(() => {
    const controller = new AbortController();
    const loadVersionBanner = async () => {
      try {
        const res = await fetch("/api/version", {
          method: "GET",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          data?: {
            installedVersion?: string | null;
            latestVersion?: string | null;
            updateAvailable?: boolean;
          };
        };
        if (!json?.data?.updateAvailable) return;
        if (!json.data.installedVersion || !json.data.latestVersion) return;
        setVersionBanner({
          installedVersion: json.data.installedVersion,
          latestVersion: json.data.latestVersion,
        });
      } catch {
        // No banner on failed checks.
      }
    };
    void loadVersionBanner();
    return () => controller.abort();
  }, []);

  // Note: ?settings=repos cleanup happens in handleSettingsOpenChange when sheet closes

  function handleSettingsOpenChange(open: boolean) {
    setSettingsOpen(open);
    if (!open) {
      setSettingsSection(null);
      // Clean up ?settings= from URL if present
      if (settingsOpenFromUrl) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("settings");
        const qs = params.toString();
        router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      }
    }
  }

  function openSettingsToRepos() {
    setSettingsSection("repos");
    setSettingsOpen(true);
  }

  const setBeatsView = useCallback((view: "queues" | "active" | "finalcut" | "retakes" | "history") => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "queues") params.delete("view");
    else params.set("view", view);
    // Reset state filter to the phase default when switching between queues/active
    if (view === "queues") {
      params.set("state", "queued");
    } else if (view === "active") {
      params.set("state", "in_action");
    }
    const qs = params.toString();
    router.push(`/beats${qs ? `?${qs}` : ""}`);
  }, [searchParams, router]);

  // Shift+] / Shift+[ to cycle views
  useEffect(() => {
    if (!isBeatsRoute) return;
    const views = ["queues", "active", "finalcut", "retakes", "history"] as const;
    type CyclableView = (typeof views)[number];
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT") return;

      // Unknown or legacy non-tab view values default to the first tab.
      const idx = views.indexOf(beatsView as CyclableView);
      const safeIdx = idx === -1 ? 0 : idx;

      if ((e.key === "}" || e.key === "]") && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setBeatsView(views[(safeIdx + 1) % views.length]);
      } else if ((e.key === "{" || e.key === "[") && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setBeatsView(views[(safeIdx - 1 + views.length) % views.length]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBeatsRoute, beatsView, setBeatsView]);

  // Shift+T to toggle terminal panel (global — works in all views)
  useEffect(() => {
    if (!isBeatsRoute) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT") return;
      if (e.key === "T" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleTerminalPanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBeatsRoute, toggleTerminalPanel]);

  // Shift+H toggles shortcut help in every Beats screen.
  useEffect(() => {
    if (!isBeatsRoute) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.tagName === "SELECT"
      ) {
        return;
      }
      if (!isHotkeyHelpToggleKey(e)) return;
      e.preventDefault();
      setHotkeyHelpOpen((prev) => toggleHotkeyHelpOpen(prev, window.localStorage));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBeatsRoute]);

  // Shift+R cycles repos forward; Cmd/Ctrl+Shift+R cycles backward (all app screens).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const direction = getRepoCycleDirection(e);
      if (!direction) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const {
        activeRepo: currentActiveRepo,
        registeredRepos: currentRegisteredRepos,
      } = useAppStore.getState();
      const repos = currentRegisteredRepos.map((r) => r.path);
      const nextRepo = cycleRepoPath(repos, currentActiveRepo, direction);
      if (!nextRepo || nextRepo === currentActiveRepo) return;
      updateUrl({ repo: nextRepo });
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [updateUrl]);

  // Button config changes per view: hidden on History, "Wrap!" on Final Cut, "Add" on Beats
  const showActionButton = beatsView === "queues" || beatsView === "active" || beatsView === "finalcut";

  const actionButton = (() => {
    if (beatsView === "finalcut") {
      // Human-action queue: shortcut emphasis for review handoff.
      return (
        <Button
          size="lg"
          variant="outline"
          className="gap-1.5 px-2.5"
          title="Human action queue"
        >
          <UserRoundCheck className="size-4" />
          Human Queue
        </Button>
      );
    }

    // Beats list: original Add / New behavior
    if (shouldChooseRepo) {
      return (
        <DropdownMenu open={createRepoMenuOpen} onOpenChange={setCreateRepoMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button size="lg" variant="success" className="gap-1.5 px-2.5" title="Choose repository to create beat (Shift+N)">
              <Plus className="size-4" />
              Add
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
        onClick={openCreateFlow}
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
          {versionBanner && !versionBannerDismissed ? (
            <div className="mb-2 flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="leading-6">
                New Foolery version <span className="font-semibold">{versionBanner.latestVersion}</span> available
                {" "}
                (installed {versionBanner.installedVersion}). Run <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">foolery update</code>.
              </p>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 text-amber-900 hover:bg-amber-100 hover:text-amber-950"
                title="Dismiss update banner"
                onClick={() => setVersionBannerDismissed(true)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              <button
                type="button"
                title="Home"
                className="flex shrink-0 cursor-pointer items-center gap-2"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (activeRepo) params.set("repo", activeRepo);
                  const qs = params.toString();
                  router.push(`/beats${qs ? `?${qs}` : ""}`);
                }}
              >
                <Image
                  src="/foolery_icon.png"
                  alt="Foolery"
                  width={152}
                  height={49}
                  unoptimized
                  className="rounded-md"
                />
              </button>
              <VersionBadge />
              <RepoSwitcher />
              {activeBeatId && (
                <button
                  type="button"
                  className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={`Viewing ${activeBeatId} — click to focus in list`}
                  onClick={() => {
                    router.push(
                      buildBeatFocusHref(activeBeatId, searchParams.toString()),
                    );
                  }}
                >
                  {activeBeatId}
                </button>
              )}
            </div>

            <SearchBar
              className="order-3 mx-0 basis-full md:order-none md:basis-auto md:flex-1 md:max-w-none"
              inputClassName="h-8"
              placeholder="Search beats..."
            />

            <NotificationBell />

            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              title="Settings"
              onClick={() => { setSettingsSection(null); setSettingsOpen(true); }}
            >
              <Settings className="size-4" />
            </Button>

            {isBeatsRoute ? (
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border bg-muted/20 p-1">
                  <Button
                    size="lg"
                    variant={beatsView === "queues" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    title="Queue beats (ready for action)"
                    onClick={() => setBeatsView("queues")}
                  >
                    <Inbox className="size-4" />
                    Queues
                  </Button>
                  <Button
                    size="lg"
                    variant={beatsView === "active" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    title="Active beats (in progress)"
                    onClick={() => setBeatsView("active")}
                  >
                    <Zap className="size-4" />
                    Active
                  </Button>
                  <Button
                    size="lg"
                    variant={beatsView === "finalcut" ? "default" : "ghost"}
                    className="relative h-8 gap-1.5 px-2.5"
                    title="Human-action queue"
                    onClick={() => setBeatsView("finalcut")}
                  >
                    <Scissors className="size-4" />
                    Human Action
                    {humanActionCount > 0 && (
                      <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                        {humanActionCount > 9 ? "9+" : humanActionCount}
                      </span>
                    )}
                  </Button>
                  <Button
                    size="lg"
                    variant={beatsView === "retakes" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    title="Regression tracking for beats in retake"
                    onClick={() => setBeatsView("retakes")}
                  >
                    <RotateCcw className="size-4" />
                    ReTakes
                  </Button>
                  <Button
                    size="lg"
                    variant={beatsView === "history" ? "default" : "ghost"}
                    className="h-8 gap-1.5 px-2.5"
                    title="Take!/Scene agent history"
                    onClick={() => setBeatsView("history")}
                  >
                    <History className="size-4" />
                    History
                  </Button>
                </div>
                <div className="grid w-[88px]">
                  {canCreate && showActionButton ? (
                    actionButton
                  ) : canCreate ? (
                    /* Invisible placeholder keeps fixed width so the view switcher stays put */
                    <div className="invisible" aria-hidden="true">
                      <Button size="lg" variant="success" className="gap-1.5 px-2.5" tabIndex={-1}>
                        <PartyPopper className="size-4" />
                        Wrap!
                      </Button>
                    </div>
                  ) : (
                    <Button size="lg" variant="outline" title="Register a repository" onClick={openSettingsToRepos}>
                      Add Repo
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {isBeatsRoute ? (
        <CreateBeatDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            setCreateOpen(false);
            setSelectedRepo(null);
            queryClient.invalidateQueries({ queryKey: ["beats"] });
          }}
          repo={selectedRepo ?? activeRepo}
        />
      ) : null}

      <HotkeyHelp open={isBeatsRoute && hotkeyHelpOpen} />
      <SettingsSheet open={effectiveSettingsOpen} onOpenChange={handleSettingsOpenChange} initialSection={effectiveSettingsSection} />
    </>
  );
}
