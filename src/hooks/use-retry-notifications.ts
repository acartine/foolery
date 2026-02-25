"use client";

import { useEffect, useRef } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import type { Bead } from "@/lib/types";

/** Extract the attempt number from a bead's labels, or null if absent. */
function extractAttempt(labels: string[]): number | null {
  for (const label of labels) {
    if (label.startsWith("attempt:") || label.startsWith("attempts:")) {
      const raw = label.startsWith("attempts:")
        ? label.slice("attempts:".length)
        : label.slice("attempt:".length);
      const num = parseInt(raw, 10);
      if (!isNaN(num) && num >= 0) return num;
    }
  }
  return null;
}

/** Extract the commit SHA from a bead's labels, or null if absent. */
function extractCommitSha(labels: string[]): string | null {
  for (const label of labels) {
    if (label.startsWith("commit:")) {
      const sha = label.slice("commit:".length).trim();
      if (sha) return sha;
    }
  }
  return null;
}

/** Extract the latest rejection reason from bead notes (last verification section). */
function extractLatestRejectionReason(notes: string | undefined): string | null {
  if (!notes) return null;
  // Find the last verification failure section
  const sections = notes.split("---");
  const lastSection = sections[sections.length - 1];
  if (!lastSection || !lastSection.includes("Verification attempt")) return null;

  // Extract text after the header line
  const lines = lastSection.trim().split("\n");
  // Skip the header line (starts with **)
  const bodyLines = lines.filter((l) => !l.startsWith("**"));
  const body = bodyLines.join(" ").trim();
  if (!body) return null;

  // Truncate for notification display
  const maxLen = 200;
  return body.length > maxLen ? body.slice(0, maxLen) + "..." : body;
}

/** Build a human-readable notification message for a retry bead. */
function buildRetryMessage(bead: Bead): string {
  const labels = bead.labels ?? [];
  const attempt = extractAttempt(labels);
  const commitSha = extractCommitSha(labels);
  const attemptSuffix = attempt !== null ? ` (attempt ${attempt})` : "";
  const commitSuffix = commitSha ? ` [commit: ${commitSha}]` : "";
  const reason = extractLatestRejectionReason(bead.notes);
  const reasonSuffix = reason ? `\n${reason}` : "";
  return `"${bead.title}" was rejected by verification${attemptSuffix}${commitSuffix} and is ready for retry${reasonSuffix}`;
}

/**
 * Watches a list of beads and fires a notification whenever a bead
 * transitions to workflowState=retake (verification rejected).
 *
 * The notification message includes the attempt number from the
 * bead's labels when available.
 */
export function useRetryNotifications(beads: Bead[]) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    const retryBeads = beads.filter((b) =>
      b.workflowState === "retake",
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
        message: buildRetryMessage(bead),
        beadId: bead.id,
      });
    }

    prevIdsRef.current = currentIds;
  }, [beads, addNotification]);
}
