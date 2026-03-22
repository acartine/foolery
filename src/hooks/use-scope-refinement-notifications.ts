"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchScopeRefinementStatus } from "@/lib/api";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";
import { useNotificationStore } from "@/stores/notification-store";
import type { ScopeRefinementCompletion } from "@/lib/types";

const SCOPE_REFINEMENT_POLL_MS = 10_000;

export interface CompletionNotification {
  message: string;
  beatId: string;
  repoPath?: string;
}

/**
 * Pure logic for filtering new completions from a batch.
 * Exported for unit testing without React.
 */
export function filterNewCompletions(
  completions: ScopeRefinementCompletion[],
  seenIds: Set<string>,
  mountedAt: number,
): { notifications: CompletionNotification[]; beatIds: string[] } {
  const notifications: CompletionNotification[] = [];
  const beatIds: string[] = [];

  for (const completion of completions) {
    if (seenIds.has(completion.id)) continue;
    seenIds.add(completion.id);
    if (completion.timestamp < mountedAt) continue;

    notifications.push({
      message: `Scope refinement complete for "${completion.beatTitle}"`,
      beatId: completion.beatId,
      repoPath: completion.repoPath,
    });
    beatIds.push(completion.beatId);
  }

  return { notifications, beatIds };
}

export function useScopeRefinementNotifications(enabled = true): void {
  const queryClient = useQueryClient();
  const addNotification = useNotificationStore((state) => state.addNotification);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const mountedAtRef = useRef<number | null>(null);

  const handleCompletions = useEffectEvent((completions: ScopeRefinementCompletion[]) => {
    const { notifications, beatIds } = filterNewCompletions(
      completions,
      seenIdsRef.current,
      mountedAtRef.current ?? 0,
    );

    for (const notification of notifications) {
      addNotification(notification);
    }

    if (notifications.length > 0) {
      void invalidateBeatListQueries(queryClient);
      for (const beatId of beatIds) {
        void queryClient.invalidateQueries({
          queryKey: ["beat", beatId],
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
