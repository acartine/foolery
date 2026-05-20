"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSettings } from "@/lib/settings-api";
import { triggerSyncRun } from "@/lib/sync-beats-api";

const AUTO_SYNC_INTERVAL_MS = 180_000;

export function useAutoSync(): void {
  const { data: settingsResult } = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchSettings(),
  });
  const autoSync =
    settingsResult?.ok && settingsResult.data
      ? settingsResult.data.autoSync
      : false;

  useEffect(() => {
    if (!autoSync) return;
    void triggerSyncRun();
    const interval = window.setInterval(() => {
      void triggerSyncRun();
    }, AUTO_SYNC_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [autoSync]);
}
