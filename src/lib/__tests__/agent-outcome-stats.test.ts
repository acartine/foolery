import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendOutcomeRecord, readOutcomeStats, resolveStatsDir, resolveStatsPath } from "@/lib/agent-outcome-stats";

describe("agent-outcome-stats", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-outcome-stats-"));
    originalCwd = process.cwd();
    originalNodeEnv = process.env.NODE_ENV;
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("always resolves stats into the application working directory", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    expect(resolveStatsDir()).toBe(join(process.cwd(), ".foolery-logs"));
    expect(resolveStatsPath()).toBe(join(process.cwd(), ".foolery-logs", "agent-success-rates.json"));
  });

  it("persists outcome records under the working directory", async () => {
    await appendOutcomeRecord({
      timestamp: "2026-03-18T12:00:00.000Z",
      beatId: "foolery-1f10",
      sessionId: "session-1",
      iteration: 1,
      agent: {
        agentId: "agent-a",
        label: "Claude",
        model: "opus",
        version: "4.6",
        command: "claude",
      },
      claimedState: "ready_for_implementation",
      claimedStep: "implementation",
      exitCode: 0,
      postExitState: "ready_for_implementation_review",
      rolledBack: false,
      alternativeAgentAvailable: true,
      success: true,
    });

    await expect(readOutcomeStats()).resolves.toEqual([
      expect.objectContaining({
        beatId: "foolery-1f10",
        postExitState: "ready_for_implementation_review",
        success: true,
      }),
    ]);
  });
});
