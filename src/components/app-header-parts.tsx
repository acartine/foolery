"use client";

import type { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Megaphone, RotateCcw, Settings,
  X, History, PartyPopper,
  Zap, Inbox, BarChart3, ListMusic,
} from "lucide-react";
import { FooleryWordmark } from "@/components/foolery-wordmark";
import { VersionBadge } from "@/components/version-badge";
import { RepoSwitcher } from "@/components/repo-switcher";
import { SearchBar } from "@/components/search-bar";
import {
  VERSION_UPDATE_COMMAND,
} from "@/components/version-update-action";
import type { AppUpdateStatus } from "@/lib/app-update-types";
import {
  NotificationBell,
} from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDisplayVersion } from "@/lib/version-display";
import { buildBeatFocusHref } from "@/lib/beat-navigation";
import type { BeatsViewId, VersionBannerData } from "./app-header-hooks";

// -----------------------------------------------------------
// VersionBannerBar
// -----------------------------------------------------------

export function VersionBannerBar(props: {
  banner: VersionBannerData;
  updateStatus: AppUpdateStatus;
  onUpdateNow: () => void;
  onDismiss: () => void;
}) {
  const {
    banner, updateStatus, onUpdateNow, onDismiss,
  } = props;
  return (
    <div className="mb-2 flex items-start justify-between gap-3 rounded-md border border-clay-200 bg-clay-100 px-3 py-2 text-sm text-clay-800">
      <p className="leading-6">
        New Foolery version{" "}
        <span className="font-semibold">
          {formatDisplayVersion(banner.latestVersion)}
        </span>{" "}
        available (installed{" "}
        {formatDisplayVersion(banner.installedVersion)}).{" "}
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto px-0 font-semibold text-clay-700"
          disabled={
            updateStatus.phase === "starting" ||
            updateStatus.phase === "updating" ||
            updateStatus.phase === "restarting"
          }
          onClick={onUpdateNow}
        >
          {renderBannerUpdateLabel(updateStatus)}
        </Button>{" "}
        if automation fails, run{" "}
        <code className="rounded bg-clay-50 px-1 py-0.5 font-mono text-xs">
          {VERSION_UPDATE_COMMAND}
        </code>
        .
      </p>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 text-clay-700 hover:bg-clay-200 hover:text-clay-800"
        title="Dismiss update banner"
        onClick={onDismiss}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function renderBannerUpdateLabel(
  status: AppUpdateStatus,
): string {
  if (status.phase === "starting" || status.phase === "updating") {
    return "Updating…";
  }
  if (status.phase === "restarting") {
    return "Restarting…";
  }
  if (status.phase === "completed") {
    return "Update complete";
  }
  if (status.phase === "failed") {
    return "Retry automatic update";
  }
  return "Update now";
}

// -----------------------------------------------------------
// HeaderBranding
// -----------------------------------------------------------

export function HeaderBranding(props: {
  activeBeatId: string | null;
  activeRepo: string | null;
  router: ReturnType<typeof useRouter>;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const {
    activeBeatId, activeRepo, router, searchParams,
  } = props;
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <button
        type="button"
        title="Home"
        className="flex shrink-0 cursor-pointer items-center gap-2"
        onClick={() => {
          const p = new URLSearchParams();
          if (activeRepo) p.set("repo", activeRepo);
          const qs = p.toString();
          router.push(`/beats${qs ? `?${qs}` : ""}`);
        }}
      >
        <FooleryWordmark className="h-[42px] w-auto text-clay-600 dark:text-paper-100" />
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
              buildBeatFocusHref(
                activeBeatId,
                searchParams.toString(),
              ),
            );
          }}
        >
          {activeBeatId}
        </button>
      )}
    </div>
  );
}

// -----------------------------------------------------------
// ActionButton
// -----------------------------------------------------------

export function ActionButton(props: {
  beatsView: string;
  shouldChooseRepo: boolean;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  registeredRepos: { path: string; name: string }[];
  openDialog: (repo: string) => void;
  openFlow: () => void;
}) {
  const {
    beatsView, shouldChooseRepo, menuOpen,
    setMenuOpen, registeredRepos, openDialog,
    openFlow,
  } = props;

  if (beatsView === "finalcut") {
    return null;
  }
  if (shouldChooseRepo) {
    return (
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            variant="success"
            className="h-8 gap-1.5 px-2.5"
            title="Choose repository to create beat (Shift+N)"
          >
            <Plus className="size-4" />
            Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {registeredRepos.map((repo) => (
            <DropdownMenuItem
              key={repo.path}
              onClick={() => openDialog(repo.path)}
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
      className="h-8 gap-1.5 px-2.5"
      title="Create new beat (Shift+N)"
      onClick={openFlow}
    >
      <Plus className="size-4" />
      Add
    </Button>
  );
}

// -----------------------------------------------------------
// ViewTab
// -----------------------------------------------------------

function ViewTab(props: {
  view: BeatsViewId;
  current: string;
  icon: React.ReactNode;
  label: string;
  title: string;
  setView: (v: BeatsViewId) => void;
  badge?: number;
}) {
  const {
    view, current, icon, label, title,
    setView, badge,
  } = props;
  return (
    <Button
      size="lg"
      variant={current === view ? "default" : "ghost"}
      className="relative h-8 gap-1.5 px-2.5"
      title={title}
      onClick={() => setView(view)}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Button>
  );
}

// -----------------------------------------------------------
// ViewSwitcher
// -----------------------------------------------------------

// -----------------------------------------------------------
// HeaderToolbar
// -----------------------------------------------------------

export function HeaderToolbar(props: {
  activeBeatId: string | null;
  activeRepo: string | null;
  router: ReturnType<typeof useRouter>;
  searchParams: ReturnType<typeof useSearchParams>;
  onOpenSettings: () => void;
  isBeatsRoute: boolean;
  viewSwitcher: React.ReactNode;
}) {
  const {
    activeBeatId, activeRepo, router,
    searchParams, onOpenSettings,
    isBeatsRoute, viewSwitcher,
  } = props;
  return (
    <div className="flex flex-wrap items-center gap-2 md:gap-3">
      <HeaderBranding
        activeBeatId={activeBeatId}
        activeRepo={activeRepo}
        router={router}
        searchParams={searchParams}
      />
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
        onClick={onOpenSettings}
      >
        <Settings className="size-4" />
      </Button>
      {isBeatsRoute ? viewSwitcher : null}
    </div>
  );
}

// -----------------------------------------------------------
// ViewSwitcher
// -----------------------------------------------------------

export function ViewSwitcher(props: {
  beatsView: string;
  setView: (v: BeatsViewId) => void;
  humanActionCount: number;
  canCreate: boolean;
  showAction: boolean;
  actionButton: React.ReactNode;
  openSettingsToRepos: () => void;
}) {
  const {
    beatsView, setView, humanActionCount,
    canCreate, showAction, actionButton,
    openSettingsToRepos,
  } = props;
  return (
    <div className="ml-auto flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border bg-muted/20 p-1">
        <ViewTab
          view="setlist" current={beatsView}
          icon={<ListMusic className="size-4" />}
          label="Setlist"
          title="Execution plans and gantt-style setlist"
          setView={setView}
        />
        <ViewTab
          view="queues" current={beatsView}
          icon={<Inbox className="size-4" />}
          label="Queues"
          title="Queue beats (ready for action)"
          setView={setView}
        />
        <ViewTab
          view="active" current={beatsView}
          icon={<Zap className="size-4" />}
          label="Active"
          title="Active beats (in progress)"
          setView={setView}
        />
        <ViewTab
          view="finalcut" current={beatsView}
          icon={<Megaphone className="size-4" />}
          label="Escalations"
          title="Escalations queue"
          setView={setView}
          badge={humanActionCount}
        />
        <ViewTab
          view="retakes" current={beatsView}
          icon={<RotateCcw className="size-4" />}
          label="ReTakes"
          title="Regression tracking for beats in retake"
          setView={setView}
        />
        <ViewTab
          view="history" current={beatsView}
          icon={<History className="size-4" />}
          label="History"
          title="Take!/Scene agent history"
          setView={setView}
        />
        <ViewTab
          view="diagnostics" current={beatsView}
          icon={<BarChart3 className="size-4" />}
          label="Diagnostics"
          title="Runtime diagnostics and lease analytics"
          setView={setView}
        />
      </div>
      <div className="grid w-[88px]">
        {canCreate && showAction ? (
          actionButton
        ) : canCreate ? (
          <div
            className="invisible"
            aria-hidden="true"
          >
            <Button
              size="lg"
              variant="success"
              className="h-8 gap-1.5 px-2.5"
              tabIndex={-1}
            >
              <PartyPopper className="size-4" />
              Wrap!
            </Button>
          </div>
        ) : (
          <Button
            size="lg"
            variant="outline"
            title="Register a repository"
            onClick={openSettingsToRepos}
          >
            Add Repo
          </Button>
        )}
      </div>
    </div>
  );
}
