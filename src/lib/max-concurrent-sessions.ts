export const DEFAULT_MAX_CONCURRENT_SESSIONS = 5;
export const MIN_MAX_CONCURRENT_SESSIONS = 1;
export const MAX_MAX_CONCURRENT_SESSIONS = 20;

export function clampMaxConcurrentSessions(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_CONCURRENT_SESSIONS;
  }
  return Math.min(
    MAX_MAX_CONCURRENT_SESSIONS,
    Math.max(MIN_MAX_CONCURRENT_SESSIONS, Math.trunc(value)),
  );
}
