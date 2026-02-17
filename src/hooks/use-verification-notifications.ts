"use client";

import { useEffect, useRef } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import type { Bead } from "@/lib/types";

/**
 * Watches a list of verification beads and fires a notification whenever
 * the count increases between refetch cycles. Relies on the caller
 * providing the latest bead array from react-query on each render.
 */
export function useVerificationNotifications(beads: Bead[]) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const lastVerificationCount = useNotificationStore(
    (s) => s.lastVerificationCount
  );
  const setLastVerificationCount = useNotificationStore(
    (s) => s.setLastVerificationCount
  );
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(beads.map((b) => b.id));

    // First load -- just record the baseline, no notification.
    if (lastVerificationCount === -1) {
      setLastVerificationCount(beads.length);
      prevIdsRef.current = currentIds;
      return;
    }

    // Find truly new bead IDs that were not in the previous set.
    const newBeads = beads.filter((b) => !prevIdsRef.current.has(b.id));

    if (newBeads.length > 0) {
      for (const bead of newBeads) {
        addNotification({
          message: `"${bead.title}" is ready for verification`,
          beadId: bead.id,
        });
      }
    }

    setLastVerificationCount(beads.length);
    prevIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beads]);
}
