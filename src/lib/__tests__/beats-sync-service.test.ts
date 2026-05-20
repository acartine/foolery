import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  getBeatsSyncState,
  runBeatsSyncJob,
  triggerBeatsSync,
  type BeatsSyncDeps,
} from "@/lib/beats-sync-service";
import {
  _resetBeatsSyncStateForTests,
  setBeatsSyncRunning,
} from "@/lib/beats-sync-state";
import type { RegisteredRepo } from "@/lib/registry";

function repo(
  path: string,
  memoryManagerType: "knots" | "beads" = "knots",
): RegisteredRepo {
  return {
    path,
    name: path.slice(1),
    addedAt: "2026-01-01T00:00:00.000Z",
    memoryManagerType,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetBeatsSyncStateForTests();
});

describe("beats sync trigger", () => {
  it("returns pre-trigger state and only launches one concurrent job", async () => {
    let releaseRun = () => {};
    const listRepos = vi.fn().mockResolvedValue([repo("/repo-a")]);
    const runRepoSync = vi.fn(
      () => new Promise<void>((resolve) => {
        releaseRun = resolve;
      }).then(() => ({ ok: true })),
    );
    const deps: BeatsSyncDeps = {
      listRepos,
      runRepoSync,
      delay: async () => {},
      random: () => 0,
      now: () => new Date("2026-05-20T10:00:00.000Z"),
    };

    const responses = await Promise.all(
      Array.from({ length: 15 }, () => triggerBeatsSync(deps)),
    );

    expect(responses).toEqual(
      Array.from({ length: 15 }, () => ({
        running: false,
        projects: [{ repoPath: "/repo-a", lastSyncedAt: null }],
      })),
    );
    expect(runRepoSync).toHaveBeenCalledTimes(1);
    releaseRun();
  });

  it("returns running state without relaunching after a job starts", async () => {
    let releaseRun = () => {};
    const runRepoSync = vi.fn(
      () => new Promise<void>((resolve) => {
        releaseRun = resolve;
      }).then(() => ({ ok: true })),
    );
    const deps: BeatsSyncDeps = {
      listRepos: () => Promise.resolve([repo("/repo-a")]),
      runRepoSync,
      delay: async () => {},
      random: () => 0,
      now: () => new Date("2026-05-20T10:00:00.000Z"),
    };

    await triggerBeatsSync(deps);
    const second = await triggerBeatsSync(deps);

    expect(second).toEqual({
      running: true,
      projects: [{ repoPath: "/repo-a", lastSyncedAt: null }],
    });
    expect(runRepoSync).toHaveBeenCalledTimes(1);
    releaseRun();
  });

  it("GET-equivalent reads state without invoking the runner", async () => {
    const runRepoSync = vi.fn();
    const state = await getBeatsSyncState({
      listRepos: () => Promise.resolve([repo("/repo-a")]),
      runRepoSync,
    });

    expect(state).toEqual({
      running: false,
      projects: [{ repoPath: "/repo-a", lastSyncedAt: null }],
    });
    expect(runRepoSync).not.toHaveBeenCalled();
  });
});

describe("beats sync job", () => {
  it("processes shuffled repos sequentially with random delays", async () => {
    const visited: string[] = [];
    const delays: number[] = [];
    const randomValues = [0.9, 0.1, 0, 0.999];
    await runBeatsSyncJob({
      listRepos: () =>
        Promise.resolve([
          repo("/repo-a"),
          repo("/repo-b", "beads"),
          repo("/repo-c"),
        ]),
      runRepoSync: async (registeredRepo) => {
        visited.push(registeredRepo.path);
        return { ok: true };
      },
      delay: async (ms) => {
        delays.push(ms);
      },
      random: () => randomValues.shift() ?? 0,
      now: () => new Date("2026-05-20T10:00:00.000Z"),
    });

    expect(visited).toEqual(["/repo-b", "/repo-a", "/repo-c"]);
    expect(delays).toEqual([2_000, 19_982]);
    expect(delays.every((ms) => ms >= 2_000 && ms < 20_000)).toBe(true);
  });

  it("updates lastSyncedAt only for successful repos", async () => {
    await runBeatsSyncJob({
      listRepos: () =>
        Promise.resolve([
          repo("/repo-a"),
          repo("/repo-b", "beads"),
        ]),
      runRepoSync: async (registeredRepo) => ({
        ok: registeredRepo.path === "/repo-a",
      }),
      delay: async () => {},
      random: () => 0,
      now: () => new Date("2026-05-20T10:00:00.000Z"),
    });

    const state = await getBeatsSyncState({
      listRepos: () =>
        Promise.resolve([
          repo("/repo-a"),
          repo("/repo-b", "beads"),
        ]),
    });

    expect(state.projects).toEqual([
      {
        repoPath: "/repo-a",
        lastSyncedAt: "2026-05-20T10:00:00.000Z",
      },
      { repoPath: "/repo-b", lastSyncedAt: null },
    ]);
  });

  it("does not start a second job while already running", async () => {
    setBeatsSyncRunning(true);
    const runRepoSync = vi.fn();

    const state = await triggerBeatsSync({
      listRepos: () => Promise.resolve([repo("/repo-a")]),
      runRepoSync,
    });

    expect(state.running).toBe(true);
    expect(runRepoSync).not.toHaveBeenCalled();
  });
});
