/**
 * Manual integration test for app-update module.
 *
 * Uses real filesystem operations (mkdtemp, writeFile, readFile, rm) against
 * real disk to test status persistence and launcher detection, so it lives
 * in `__manual_tests__/` and is excluded from the default suite per the
 * project's Hermetic Test Policy. Run with `bun run test:manual`.
 */

import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

describe("app-update status", () => {
  it("returns idle status when no persisted status exists", async () => {
    const tempDir = await makeTempDir();

    const status = await readAppUpdateStatus({
      ...process.env,
      FOOLERY_STATE_DIR: tempDir,
      FOOLERY_UPDATE_STATUS_PATH: undefined,
      FOOLERY_UPDATE_LOG_PATH: undefined,
    });

    expect(status.phase).toBe("idle");
    expect(status.fallbackCommand).toBe(
      VERSION_UPDATE_COMMAND,
    );
  });
});

describe("app-update startup", () => {
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
      FOOLERY_UPDATE_STATUS_PATH: undefined,
      FOOLERY_UPDATE_LOG_PATH: undefined,
    });

    expect(result.started).toBe(true);
    expect(result.status.phase).toBe("updating");
    expect(result.status.workerPid).toBe(4321);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("persists a failure status and log when startup fails early", async () => {
    const tempDir = await makeTempDir();
    const launcherPath = join(tempDir, "missing-foolery");
    const statusPath = join(tempDir, "app-update-status.json");
    const logPath = join(tempDir, "app-update.log");

    await expect(
      startAppUpdate({
        ...process.env,
        FOOLERY_STATE_DIR: tempDir,
        FOOLERY_LAUNCHER_PATH: launcherPath,
        FOOLERY_UPDATE_STATUS_PATH: statusPath,
        FOOLERY_UPDATE_LOG_PATH: logPath,
      }),
    ).rejects.toThrow();

    const status = JSON.parse(
      await readFile(statusPath, "utf8"),
    ) as {
      phase: string;
      error: string;
      launcherPath: string;
    };
    expect(status.phase).toBe("failed");
    expect(status.error).toMatch(/missing-foolery/);
    expect(status.launcherPath).toBe(launcherPath);

    const log = await readFile(logPath, "utf8");
    expect(log).toContain(
      `Update requested for launcher ${launcherPath}`,
    );
    expect(log).toContain(
      "Update failed before worker start:",
    );
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
});

describe("app-update request validation", () => {
  it("accepts loopback host aliases on the same port", () => {
    const good = new NextRequest(
      "http://localhost:3210/api/app-update",
      {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3210",
        },
      },
    );
    const bad = new NextRequest(
      "http://localhost:3210/api/app-update",
      {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:9999",
        },
      },
    );

    expect(isAllowedLocalUpdateRequest(good)).toBe(true);
    expect(isAllowedLocalUpdateRequest(bad)).toBe(false);
  });

  it("accepts same-origin POSTs from non-loopback hostnames", () => {
    const sameOrigin = new NextRequest(
      "http://adrian:3210/api/app-update",
      {
        method: "POST",
        headers: { origin: "http://adrian:3210" },
      },
    );
    const crossOrigin = new NextRequest(
      "http://adrian:3210/api/app-update",
      {
        method: "POST",
        headers: { origin: "http://evil.example:3210" },
      },
    );

    expect(isAllowedLocalUpdateRequest(sameOrigin)).toBe(true);
    expect(isAllowedLocalUpdateRequest(crossOrigin)).toBe(false);
  });

  it("accepts same-origin POSTs when next-server is bound to 0.0.0.0", () => {
    // Production case: `next start --hostname 0.0.0.0` makes
    // request.nextUrl.hostname report "0.0.0.0", but the browser sends
    // Host: adrian:3210 and Origin: http://adrian:3210. Origin must be
    // matched against the Host header, not against nextUrl.
    const sameOrigin = new NextRequest(
      "http://0.0.0.0:3210/api/app-update",
      {
        method: "POST",
        headers: {
          host: "adrian:3210",
          origin: "http://adrian:3210",
        },
      },
    );
    const crossOrigin = new NextRequest(
      "http://0.0.0.0:3210/api/app-update",
      {
        method: "POST",
        headers: {
          host: "adrian:3210",
          origin: "http://evil.example:3210",
        },
      },
    );

    expect(isAllowedLocalUpdateRequest(sameOrigin)).toBe(true);
    expect(isAllowedLocalUpdateRequest(crossOrigin)).toBe(false);
  });

  it("respects x-forwarded-host and x-forwarded-proto when present", () => {
    const sameOrigin = new NextRequest(
      "http://0.0.0.0:3210/api/app-update",
      {
        method: "POST",
        headers: {
          host: "internal.upstream:3210",
          "x-forwarded-host": "adrian:3210",
          "x-forwarded-proto": "https",
          origin: "https://adrian:3210",
        },
      },
    );

    expect(isAllowedLocalUpdateRequest(sameOrigin)).toBe(true);
  });
});
