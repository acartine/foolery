import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  isAllowedLocalUpdateRequest,
  readAppUpdateStatus,
  startAppUpdate,
  VERSION_UPDATE_COMMAND,
} from "@/lib/app-update";
import { NextRequest } from "next/server";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "foolery-update-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app-update", () => {
  it("returns idle status when no persisted status exists", async () => {
    const tempDir = await makeTempDir();

    const status = await readAppUpdateStatus({
      ...process.env,
      FOOLERY_STATE_DIR: tempDir,
    });

    expect(status.phase).toBe("idle");
    expect(status.fallbackCommand).toBe(
      VERSION_UPDATE_COMMAND,
    );
  });

  it("starts a detached update worker and persists status", async () => {
    const tempDir = await makeTempDir();
    const launcherPath = join(tempDir, "foolery");
    await writeFile(launcherPath, "#!/usr/bin/env bash\n", "utf8");
    await chmod(launcherPath, 0o755);
    mockSpawn.mockReturnValue({
      pid: 4321,
      unref: vi.fn(),
    });

    const result = await startAppUpdate({
      ...process.env,
      FOOLERY_STATE_DIR: tempDir,
      FOOLERY_LAUNCHER_PATH: launcherPath,
    });

    expect(result.started).toBe(true);
    expect(result.status.phase).toBe("updating");
    expect(result.status.workerPid).toBe(4321);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("refuses to start a second update while one is in progress", async () => {
    const tempDir = await makeTempDir();
    const launcherPath = join(tempDir, "foolery");
    await writeFile(launcherPath, "#!/usr/bin/env bash\n", "utf8");
    await chmod(launcherPath, 0o755);
    await writeFile(
      join(tempDir, "app-update-status.json"),
      JSON.stringify({
        phase: "updating",
        message: "busy",
        error: null,
        startedAt: Date.now(),
        endedAt: null,
        workerPid: process.pid,
        launcherPath,
        fallbackCommand: VERSION_UPDATE_COMMAND,
      }),
      "utf8",
    );

    const result = await startAppUpdate({
      ...process.env,
      FOOLERY_STATE_DIR: tempDir,
      FOOLERY_LAUNCHER_PATH: launcherPath,
      FOOLERY_UPDATE_STATUS_PATH: join(
        tempDir,
        "app-update-status.json",
      ),
    });

    expect(result.started).toBe(false);
    expect(result.status.phase).toBe("updating");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("accepts only same-origin local POST callers", () => {
    const good = new NextRequest(
      "http://localhost:3210/api/app-update",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3210",
        },
      },
    );
    const bad = new NextRequest(
      "http://localhost:3210/api/app-update",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
        },
      },
    );

    expect(isAllowedLocalUpdateRequest(good)).toBe(true);
    expect(isAllowedLocalUpdateRequest(bad)).toBe(false);
  });
});
