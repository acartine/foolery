export interface TerminalTimeAnchor {
  createdAt?: string | null;
  latestTakeStartedAt?: string | null;
}

function normalizeIso(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Terminal elapsed timers should track the latest Take! execution for the beat.
 * Fall back to beat creation time when no take timestamp is available.
 */
export function resolveTerminalElapsedAnchor(
  anchor: TerminalTimeAnchor | null | undefined,
): string | null {
  return normalizeIso(anchor?.latestTakeStartedAt) ?? normalizeIso(anchor?.createdAt);
}

