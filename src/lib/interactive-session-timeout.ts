export const DEFAULT_INTERACTIVE_SESSION_TIMEOUT_MINUTES = 10;
export const MIN_INTERACTIVE_SESSION_TIMEOUT_MINUTES = 1;
export const MAX_INTERACTIVE_SESSION_TIMEOUT_MINUTES = 240;

export function interactiveSessionTimeoutMinutesToMs(
  minutes: number,
): number {
  return minutes * 60_000;
}

export function resolveInteractiveSessionWatchdogTimeoutMs(
  interactive: boolean,
  timeoutMinutes: number,
): number | null {
  if (!interactive) return null;
  return interactiveSessionTimeoutMinutesToMs(
    timeoutMinutes,
  );
}
