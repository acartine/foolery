"use client";

import { useEffect, useRef } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import type { Beat } from "@/lib/types";

/**
 * Watches a list of verification beats and fires a notification whenever
 * the count increases between refetch cycles. Relies on the caller
 * providing the latest beat array from react-query on each render.
 */
export function useVerificationNotifications(beats: Beat[]) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const lastVerificationCount = useNotificationStore(
    (s) => s.lastVerificationCount
  );
  const setLastVerificationCount = useNotificationStore(
    (s) => s.setLastVerificationCount
  );
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(beats.map((b) => b.id));

    // First load -- just record the baseline, no notification.
    if (lastVerificationCount === -1) {
      setLastVerificationCount(beats.length);
      prevIdsRef.current = currentIds;
      return;
    }

    // Find truly new beat IDs that were not in the previous set.
    const newBeats = beats.filter((b) => !prevIdsRef.current.has(b.id));

    if (newBeats.length > 0) {
      for (const beat of newBeats) {
        addNotification({
          message: `"${beat.title}" is awaiting human action`,
          beadId: beat.id,
        });
      }
    }

    setLastVerificationCount(beats.length);
    prevIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats]);
}
