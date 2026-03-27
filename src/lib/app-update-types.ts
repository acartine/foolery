export type AppUpdatePhase =
  | "idle"
  | "starting"
  | "updating"
  | "restarting"
  | "completed"
  | "failed";

export type AppUpdateStatus = {
  phase: AppUpdatePhase;
  message: string | null;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
  workerPid: number | null;
  launcherPath: string | null;
  fallbackCommand: string;
};
