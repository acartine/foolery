"use client";

import {
  useCallback, useEffect, useMemo, useState,
} from "react";
import type { useRouter, useSearchParams } from "next/navigation";
import type { SettingsSection } from "@/components/settings-sheet";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUpdateUrl } from "@/hooks/use-update-url";
import {
  cycleRepoPath,
  getRepoCycleDirection,
  isHotkeyHelpToggleKey,
  readHotkeyHelpOpen,
  toggleHotkeyHelpOpen,
} from "@/lib/hotkey-help-state";
import {
  fetchVersionStatus,
  type VersionStatusData,
} from "@/lib/version-status-client";

export type VersionBannerData = {
  installedVersion: string;
  latestVersion: string;
};

export function buildVersionBannerData(
  status: VersionStatusData | null,
): VersionBannerData | null {
  if (
    !status?.updateAvailable ||
    !status.installedVersion ||
    !status.latestVersion
  ) {
    return null;
  }
  return {
    installedVersion: status.installedVersion,
    latestVersion: status.latestVersion,
  };
}

export type BeatsViewId =
  | "setlist" | "overview" | "queues" | "active"
  | "finalcut" | "retakes" | "history" | "diagnostics";

export const VIEWS: readonly BeatsViewId[] = [
  "setlist", "overview", "queues", "active", "finalcut",
  "retakes", "history", "diagnostics",
];

// -----------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------

function isInputTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return (
    t.tagName === "TEXTAREA" ||
    t.tagName === "INPUT" ||
    t.tagName === "SELECT"
  );
}

function isDialogOpen(): boolean {
  return Boolean(
    document.querySelector('[role="dialog"]'),
  );
}

// -----------------------------------------------------------
// Hooks
// -----------------------------------------------------------

export function useVersionBanner() {
  const [status, setStatus] =
    useState<VersionStatusData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const next = await fetchVersionStatus({
          signal: ctrl.signal,
        });
        if (next) setStatus(next);
      } catch {
        // No banner or badge version update on failed checks.
      }
    };
    void load();
    return () => ctrl.abort();
  }, []);

  return {
    status,
    banner: buildVersionBannerData(status),
    dismissed,
    dismiss: () => setDismissed(true),
    setStatus,
  };
}

export function useCreateBeatFlow() {
  const { activeRepo, registeredRepos } = useAppStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] =
    useState<string | null>(null);

  const canCreate =
    Boolean(activeRepo) || registeredRepos.length > 0;
  const shouldChooseRepo =
    !activeRepo && registeredRepos.length > 1;
  const defaultRepo = useMemo(
    () => activeRepo ?? registeredRepos[0]?.path ?? null,
    [activeRepo, registeredRepos],
  );

  const openDialog = useCallback(
    (repo: string | null) => {
      setMenuOpen(false);
      setSelectedRepo(repo);
      setCreateOpen(true);
    }, [],
  );

  const openFlow = useCallback(() => {
    if (shouldChooseRepo) { setMenuOpen(true); return; }
    openDialog(defaultRepo);
  }, [defaultRepo, openDialog, shouldChooseRepo]);

  return {
    createOpen, setCreateOpen,
    menuOpen, setMenuOpen,
    selectedRepo, setSelectedRepo,
    canCreate, shouldChooseRepo, defaultRepo,
    registeredRepos, openDialog, openFlow,
  };
}

export function useSettingsSheet(
  searchParams: ReturnType<typeof useSearchParams>,
  pathname: string,
  router: ReturnType<typeof useRouter>,
) {
  const param = searchParams.get("settings");
  const urlSection = settingsSectionFromParam(param);
  const fromUrl = urlSection !== null;
  const [open, setOpen] = useState(fromUrl);
  const [section, setSection] =
    useState<SettingsSection>(urlSection);

  const effectiveOpen = open || fromUrl;
  const effectiveSection: SettingsSection =
    urlSection ?? section;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSection(null);
      if (fromUrl) {
        const p = new URLSearchParams(
          searchParams.toString(),
        );
        p.delete("settings");
        const qs = p.toString();
        router.replace(
          `${pathname}${qs ? `?${qs}` : ""}`,
          { scroll: false },
        );
      }
    }
  }

  function openToRepos() {
    setSection("repos");
    setOpen(true);
  }

  return {
    effectiveOpen, effectiveSection,
    handleOpenChange, openToRepos,
  };
}

export function settingsSectionFromParam(
  param: string | null,
): SettingsSection {
  if (param === "repos" || param === "dispatch") {
    return param;
  }
  return null;
}

export function useBeatsViewSetter(
  searchParams: ReturnType<typeof useSearchParams>,
  router: ReturnType<typeof useRouter>,
) {
  return useCallback((view: BeatsViewId) => {
    const p = new URLSearchParams(
      searchParams.toString(),
    );
    if (view === "queues") p.delete("view");
    else p.set("view", view);
    if (view === "queues") p.set("state", "queued");
    else if (view === "overview") p.set("state", "all");
    else if (view === "active") {
      p.set("state", "in_action");
    }
    const qs = p.toString();
    router.push(`/beats${qs ? `?${qs}` : ""}`);
  }, [searchParams, router]);
}

// -----------------------------------------------------------
// Keyboard-shortcut hooks
// -----------------------------------------------------------

export function useCreateBeatHotkey(
  isBeats: boolean,
  beatsView: string,
  canCreate: boolean,
  openFlow: () => void,
) {
  useEffect(() => {
    if (!isBeats || !canCreate) return;
    if (
      beatsView !== "queues" &&
      beatsView !== "overview" &&
      beatsView !== "active"
    ) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "N" || !e.shiftKey) return;
      if (isDialogOpen() || isInputTarget(e)) return;
      e.preventDefault();
      openFlow();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener(
      "keydown", handler,
    );
  }, [beatsView, canCreate, isBeats, openFlow]);
}

export function useViewCycleHotkey(
  isBeats: boolean,
  beatsView: string,
  setView: (v: BeatsViewId) => void,
) {
  useEffect(() => {
    if (!isBeats) return;
    const handler = (e: KeyboardEvent) => {
      if (isDialogOpen() || isInputTarget(e)) return;
      const idx = VIEWS.indexOf(
        beatsView as BeatsViewId,
      );
      const safe = idx === -1 ? 0 : idx;
      const fwd =
        (e.key === "}" || e.key === "]") &&
        e.shiftKey && !e.metaKey && !e.ctrlKey;
      const bwd =
        (e.key === "{" || e.key === "[") &&
        e.shiftKey && !e.metaKey && !e.ctrlKey;
      if (!fwd && !bwd) return;
      e.preventDefault();
      const d = fwd ? 1 : -1;
      const next =
        (safe + d + VIEWS.length) % VIEWS.length;
      setView(VIEWS[next]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener(
      "keydown", handler,
    );
  }, [isBeats, beatsView, setView]);
}

export function useTerminalToggleHotkey(
  isBeats: boolean,
) {
  const toggle = useTerminalStore((s) => s.togglePanel);
  useEffect(() => {
    if (!isBeats) return;
    const handler = (e: KeyboardEvent) => {
      if (isDialogOpen() || isInputTarget(e)) return;
      if (
        e.key === "T" && e.shiftKey &&
        !e.metaKey && !e.ctrlKey
      ) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener(
      "keydown", handler,
    );
  }, [isBeats, toggle]);
}

export function useHotkeyHelpHotkey(isBeats: boolean) {
  const [open, setOpen] = useState(() =>
    readHotkeyHelpOpen(
      typeof window === "undefined"
        ? null
        : window.localStorage,
    ),
  );
  useEffect(() => {
    if (!isBeats) return;
    const handler = (e: KeyboardEvent) => {
      if (isDialogOpen() || isInputTarget(e)) return;
      if (!isHotkeyHelpToggleKey(e)) return;
      e.preventDefault();
      setOpen((prev) =>
        toggleHotkeyHelpOpen(
          prev, window.localStorage,
        ),
      );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener(
      "keydown", handler,
    );
  }, [isBeats]);
  return open;
}

export function useRepoCycleHotkey() {
  const updateUrl = useUpdateUrl();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const dir = getRepoCycleDirection(e);
      if (!dir || isDialogOpen()) return;
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t?.isContentEditable
      ) return;
      e.preventDefault();
      e.stopPropagation();
      const {
        activeRepo: cur,
        registeredRepos: regs,
      } = useAppStore.getState();
      const repos = regs.map((r) => r.path);
      const next = cycleRepoPath(repos, cur, dir);
      if (!next || next === cur) return;
      updateUrl({ repo: next });
    };
    window.addEventListener(
      "keydown", handler, { capture: true },
    );
    return () => window.removeEventListener(
      "keydown", handler, { capture: true },
    );
  }, [updateUrl]);
}
