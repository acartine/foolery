"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BeatsScope } from "@/lib/api";

/** Keep one multiplexed stream per Beats screen; retain polling until ready. */
export function useBeadsJournal(scope: BeatsScope, enabled: boolean): boolean {
  const queryClient = useQueryClient();
  const { key, repo } = scope;
  const connection = useMemo(() => ({ key, repo, enabled }), [key, repo, enabled]);
  const [liveConnection, setLiveConnection] = useState<object | null>(null);
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const params = new URLSearchParams();
    if (repo) params.set("_repo", repo);
    const source = new EventSource(`/api/beats/events?${params}`);
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      // Bursts (e.g. dependency recomputation) need one filtered cache read.
      if (refresh) return;
      refresh = setTimeout(() => {
        refresh = undefined;
        void queryClient.invalidateQueries({ queryKey: ["beats"] });
      }, 100);
    };
    source.onmessage = (event) => {
      try {
        const notice = JSON.parse(event.data) as { type: string; complete?: boolean };
        setLiveConnection(notice.complete ? connection : null);
        if (notice.type === "ready" || notice.type === "change") invalidate();
        if (notice.type === "error") {
          console.error("FOOLERY BEADS JOURNAL FAILURE", event.data);
        }
      } catch (error) {
        setLiveConnection(null);
        console.error("FOOLERY BEADS JOURNAL FAILURE", error);
      }
    };
    source.onerror = () => setLiveConnection(null);
    return () => {
      source.close();
      clearTimeout(refresh);
    };
  }, [key, repo, enabled, queryClient, connection]);
  return enabled && liveConnection === connection;
}
