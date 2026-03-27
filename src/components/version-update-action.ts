"use client";

import {
  useCallback, useEffect, useRef, useState,
} from "react";
import type { AppUpdateStatus } from "@/lib/app-update-types";

export const VERSION_UPDATE_COMMAND =
  "foolery update && foolery restart";

const POLL_INTERVAL_MS = 1500;

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
    if (!res.ok || !json.data) {
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

function isBusy(status: AppUpdateStatus): boolean {
  return (
    status.phase === "starting" ||
    status.phase === "updating" ||
    status.phase === "restarting"
  );
}

export function useVersionUpdateAction() {
  const [status, setStatus] = useState<AppUpdateStatus>(
    idleUpdateStatus(),
  );
  const pollTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
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

  const startUpdate = useCallback(async () => {
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
