"use client";

import { useEffect, useRef } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import type { Beat } from "@/lib/types";

export function selectTerminalShippedBeats(beats: Beat[]): Beat[] {
  return beats.filter((b) => b.state === "shipped" || b.state === "closed");
}

export function diffNewlyShippedBeats(
  beats: Beat[],
  previousTerminalIds: ReadonlySet<string>,
): {
  terminalIds: Set<string>;
  newlyShipped: Beat[];
} {
  const terminalBeats = selectTerminalShippedBeats(beats);
  const terminalIds = new Set(terminalBeats.map((b) => b.id));
  const newlyShipped = terminalBeats.filter((b) => !previousTerminalIds.has(b.id));
  return { terminalIds, newlyShipped };
}

/**
 * Watches a list of beats and fires a notification whenever a beat
 * transitions to a shipped (or closed) terminal state.
 */
export function useShippedNotifications(beats: Beat[]) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    const { terminalIds, newlyShipped } = diffNewlyShippedBeats(
      beats,
      prevIdsRef.current,
    );

    // First load — just record baseline, no notification.
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevIdsRef.current = terminalIds;
      return;
    }

    // Fire notification for newly-shipped beats
    for (const beat of newlyShipped) {
      addNotification({
        message: `"${beat.title}" has been shipped`,
        beadId: beat.id,
      });
    }

    prevIdsRef.current = terminalIds;
  }, [beats, addNotification]);
}
