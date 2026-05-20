export interface BeatsSyncProjectState {
  repoPath: string;
  lastSyncedAt: string | null;
}

export interface BeatsSyncState {
  running: boolean;
  projects: BeatsSyncProjectState[];
}

const state: BeatsSyncState = {
  running: false,
  projects: [],
};

export function getBeatsSyncStateSnapshot(): BeatsSyncState {
  return {
    running: state.running,
    projects: state.projects.map((project) => ({ ...project })),
  };
}

export function isBeatsSyncRunning(): boolean {
  return state.running;
}

export function setBeatsSyncRunning(running: boolean): void {
  state.running = running;
}

export function upsertBeatsSyncProject(repoPath: string): BeatsSyncProjectState {
  const existing = state.projects.find((project) => project.repoPath === repoPath);
  if (existing) return existing;
  const next = { repoPath, lastSyncedAt: null };
  state.projects.push(next);
  state.projects.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
  return next;
}

export function markBeatsSyncProjectSucceeded(
  repoPath: string,
  isoTimestamp: string,
): void {
  upsertBeatsSyncProject(repoPath).lastSyncedAt = isoTimestamp;
}

export function _resetBeatsSyncStateForTests(): void {
  state.running = false;
  state.projects = [];
}
