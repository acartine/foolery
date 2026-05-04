"use client";

import {
  useCallback, useEffect, useRef, useState,
} from "react";
import type { AppUpdateStatus } from "@/lib/app-update-types";

export const VERSION_UPDATE_COMMAND =
  "foolery update && foolery restart";

const POLL_INTERVAL_MS = 1500;
export const UPDATE_COMPLETE_RELOAD_DELAY_MS = 4000;

type TimeoutHandle = ReturnType<typeof setTimeout>;
type TimeoutScheduler = (
  callback: () => void,
  delay: number,
) => TimeoutHandle;

export function scheduleUpdateCompleteReload(
  reload: () => void = () => {
    window.location.reload();
  },
  setTimeoutImpl: TimeoutScheduler = setTimeout,
): TimeoutHandle {
  return setTimeoutImpl(
    reload,
    UPDATE_COMPLETE_RELOAD_DELAY_MS,
  );
}

export function idleUpdateStatus(): AppUpdateStatus {
  return {
    phase: "idle",
    message: null,
    error: null,
    startedAt: null,
    endedAt: null,
    workerPid: null,
    launcherPath: null,
    fallbackCommand: VERSION_UPDATE_COMMAND,
  };
}

async function requestStatus(
  url: string,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch,
): Promise<AppUpdateStatus | null> {
  try {
    const res = await fetchImpl(url, init);
    const json = (await res.json()) as {
      data?: AppUpdateStatus;
    };
    if (!json.data) {
      return null;
    }
    return json.data;
  } catch {
    return null;
  }
}

export function readVersionUpdateStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<AppUpdateStatus | null> {
  return requestStatus(
    "/api/app-update",
    { method: "GET" },
    fetchImpl,
  );
}

export function triggerVersionUpdate(
  fetchImpl: typeof fetch = fetch,
): Promise<AppUpdateStatus | null> {
  return requestStatus(
    "/api/app-update",
    { method: "POST" },
    fetchImpl,
  );
}

function isBusyPhase(
  phase: AppUpdateStatus["phase"],
): boolean {
  return (
    phase === "starting" ||
    phase === "updating" ||
    phase === "restarting"
  );
}

function isBusy(status: AppUpdateStatus): boolean {
  return isBusyPhase(status.phase);
}

function shouldAutoReloadCompletedPhase(
  phase: AppUpdateStatus["phase"],
  observedActiveUpdate: boolean,
  hasPendingReload: boolean,
): boolean {
  return (
    phase === "completed" &&
    observedActiveUpdate &&
    !hasPendingReload
  );
}

export function shouldAutoReloadCompletedUpdate(
  status: AppUpdateStatus,
  observedActiveUpdate: boolean,
  hasPendingReload: boolean,
): boolean {
  return shouldAutoReloadCompletedPhase(
    status.phase,
    observedActiveUpdate,
    hasPendingReload,
  );
}

export function useVersionUpdateAction() {
  const [status, setStatus] = useState<AppUpdateStatus>(
    idleUpdateStatus(),
  );
  const pollTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadTimerRef =
    useRef<TimeoutHandle | null>(null);
  const shouldReloadOnCompletionRef = useRef(false);
  const updatePhase = status.phase;

  useEffect(() => () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await readVersionUpdateStatus();
    if (next) {
      setStatus(next);
    }
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const next = await readVersionUpdateStatus();
      if (!cancelled && next) {
        setStatus(next);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isBusy(status)) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    pollTimerRef.current = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [refresh, status]);

  useEffect(() => {
    if (isBusyPhase(updatePhase)) {
      shouldReloadOnCompletionRef.current = true;
    }

    if (updatePhase !== "completed") {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      return;
    }

    if (shouldAutoReloadCompletedPhase(
      updatePhase,
      shouldReloadOnCompletionRef.current,
      Boolean(reloadTimerRef.current),
    )) {
      reloadTimerRef.current = scheduleUpdateCompleteReload();
    }
  }, [updatePhase]);

  const startUpdate = useCallback(async () => {
    shouldReloadOnCompletionRef.current = true;
    const next = await triggerVersionUpdate();
    if (!next) {
      setStatus({
        ...idleUpdateStatus(),
        phase: "failed",
        message: "Automatic update failed",
        error: "Failed to reach update API.",
        endedAt: Date.now(),
      });
      return false;
    }

    setStatus(next);
    return next.phase !== "failed";
  }, []);

  return {
    status,
    triggerUpdate: startUpdate,
  } as const;
}
