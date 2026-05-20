import type { RegisteredRepo } from "@/lib/registry";
import { listRepos as listRegisteredRepos } from "@/lib/registry";
import {
  getBeatsSyncStateSnapshot,
  isBeatsSyncRunning,
  markBeatsSyncProjectSucceeded,
  setBeatsSyncRunning,
  upsertBeatsSyncProject,
  type BeatsSyncState,
} from "@/lib/beats-sync-state";
import {
  runRepoSync as defaultRunRepoSync,
  type BeatsSyncRunResult,
} from "@/lib/beats-sync-runner";
import { serverLog } from "@/lib/server-logger";

export interface BeatsSyncDeps {
  listRepos?: () => Promise<RegisteredRepo[]>;
  runRepoSync?: (repo: RegisteredRepo) => Promise<BeatsSyncRunResult>;
  delay?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
}

const MIN_DELAY_MS = 2_000;
const DELAY_SPREAD_MS = 18_000;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function syncableRepos(repos: RegisteredRepo[]): RegisteredRepo[] {
  return repos.filter(
    (repo) =>
      repo.memoryManagerType === "knots" || repo.memoryManagerType === "beads",
  );
}

function shuffleRepos(
  repos: RegisteredRepo[],
  random: () => number,
): RegisteredRepo[] {
  const shuffled = [...repos];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function mergeDeps(deps: BeatsSyncDeps = {}): Required<BeatsSyncDeps> {
  return {
    listRepos: deps.listRepos ?? listRegisteredRepos,
    runRepoSync: deps.runRepoSync ?? defaultRunRepoSync,
    delay: deps.delay ?? defaultDelay,
    random: deps.random ?? Math.random,
    now: deps.now ?? (() => new Date()),
  };
}

async function hydrateProjects(deps: BeatsSyncDeps = {}): Promise<void> {
  const listRepos = deps.listRepos ?? listRegisteredRepos;
  const repos = syncableRepos(await listRepos());
  for (const repo of repos) upsertBeatsSyncProject(repo.path);
}

export async function getBeatsSyncState(
  deps: BeatsSyncDeps = {},
): Promise<BeatsSyncState> {
  await hydrateProjects(deps);
  return getBeatsSyncStateSnapshot();
}

export async function triggerBeatsSync(
  deps: BeatsSyncDeps = {},
): Promise<BeatsSyncState> {
  const preState = await getBeatsSyncState(deps);
  if (isBeatsSyncRunning()) return preState;

  setBeatsSyncRunning(true);
  void runBeatsSyncJob(deps);
  return preState;
}

export async function runBeatsSyncJob(
  deps: BeatsSyncDeps = {},
): Promise<void> {
  const merged = mergeDeps(deps);
  try {
    const repos = shuffleRepos(syncableRepos(await merged.listRepos()), merged.random);
    for (let index = 0; index < repos.length; index++) {
      const repo = repos[index];
      if (!repo) continue;
      const result = await merged.runRepoSync(repo);
      if (result.ok) {
        markBeatsSyncProjectSucceeded(
          repo.path,
          merged.now().toISOString(),
        );
      }
      if (index < repos.length - 1) {
        const ms = MIN_DELAY_MS + Math.floor(merged.random() * DELAY_SPREAD_MS);
        await merged.delay(ms);
      }
    }
  } catch (error) {
    serverLog("error", "beats-sync", "sync job failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    setBeatsSyncRunning(false);
  }
}
