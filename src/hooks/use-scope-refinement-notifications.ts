"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchScopeRefinementStatus } from "@/lib/api";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";
import { useNotificationStore } from "@/stores/notification-store";
import type { ScopeRefinementCompletion } from "@/lib/types";

const SCOPE_REFINEMENT_POLL_MS = 10_000;

export function useScopeRefinementNotifications(enabled = true): void {
  const queryClient = useQueryClient();
  const addNotification = useNotificationStore((state) => state.addNotification);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const mountedAtRef = useRef<number | null>(null);

  const handleCompletions = useEffectEvent((completions: ScopeRefinementCompletion[]) => {
    let sawNewCompletion = false;

    for (const completion of completions) {
      if (seenIdsRef.current.has(completion.id)) continue;
      seenIdsRef.current.add(completion.id);
      if (mountedAtRef.current !== null && completion.timestamp < mountedAtRef.current) continue;

      sawNewCompletion = true;
      addNotification({
        message: `Scope refinement complete for "${completion.beatTitle}"`,
        beatId: completion.beatId,
        repoPath: completion.repoPath,
      });
    }

    if (sawNewCompletion) {
      void invalidateBeatListQueries(queryClient);
      // Also invalidate any open beat-detail queries so the refined
      // title/description/acceptance appear without a manual refresh.
      for (const completion of completions) {
        void queryClient.invalidateQueries({
          queryKey: ["beat", completion.beatId],
          refetchType: "all",
        });
      }
    }
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    mountedAtRef.current = Date.now();

    const poll = async () => {
      const result = await fetchScopeRefinementStatus();
      if (!result.ok || !result.data || cancelled) return;
      handleCompletions(result.data.completions);
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, SCOPE_REFINEMENT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);
}
