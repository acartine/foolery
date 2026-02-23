"use client";

import { useEffect, useRef } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import type { Bead } from "@/lib/types";

/**
 * Watches a list of beads and fires a notification whenever a bead
 * transitions to stage:retry (verification rejected).
 */
export function useRetryNotifications(beads: Bead[]) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    const retryBeads = beads.filter((b) =>
      b.labels?.includes("stage:retry"),
    );
    const currentIds = new Set(retryBeads.map((b) => b.id));

    // First load — just record baseline, no notification.
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevIdsRef.current = currentIds;
      return;
    }

    // Fire notification for newly-appeared retry beads
    const newRetries = retryBeads.filter((b) => !prevIdsRef.current.has(b.id));
    for (const bead of newRetries) {
      addNotification({
        message: `"${bead.title}" was rejected by verification and is ready for retry`,
        beadId: bead.id,
      });
    }

    prevIdsRef.current = currentIds;
  }, [beads, addNotification]);
}
