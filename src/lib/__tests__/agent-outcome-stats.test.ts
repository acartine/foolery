import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type AgentOutcomeStatsModule = typeof import("../agent-outcome-stats");

describe("agent-outcome-stats", () => {
  let tempDir: string;
  let originalNodeEnv: string | undefined;
  let stats: AgentOutcomeStatsModule;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-outcome-stats-"));
    originalNodeEnv = process.env.NODE_ENV;
    stats = await import(`../agent-outcome-stats?test=${Date.now()}`);
  });

  afterEach(async () => {
    if (originalNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("always resolves stats into the application working directory", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    expect(stats.resolveStatsDir(tempDir)).toBe(join(tempDir, ".foolery-logs"));
    expect(stats.resolveStatsPath(tempDir)).toBe(join(tempDir, ".foolery-logs", "agent-success-rates.json"));
  });

  it("persists outcome records under the working directory", async () => {
    await stats.appendOutcomeRecord({
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
      agentType: "claude:opus",
      exitCode: 0,
      postExitState: "ready_for_implementation_review",
      rolledBack: false,
      alternativeAgentAvailable: true,
      outcome: "advanced_to_next_queue",
      success: true,
    }, tempDir);

    await expect(stats.readOutcomeStats(tempDir)).resolves.toEqual([
      expect.objectContaining({
        beatId: "foolery-1f10",
        agentType: "claude:opus",
        outcome: "advanced_to_next_queue",
        postExitState: "ready_for_implementation_review",
        success: true,
      }),
    ]);
  });

  it("writes aggregate success summaries by agent type", async () => {
    await stats.appendOutcomeRecord({
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
      agentType: "claude:opus",
      exitCode: 0,
      postExitState: "ready_for_implementation_review",
      rolledBack: false,
      alternativeAgentAvailable: true,
      outcome: "advanced_to_next_queue",
      success: true,
    }, tempDir);

    await stats.appendOutcomeRecord({
      timestamp: "2026-03-18T12:05:00.000Z",
      beatId: "foolery-1f11",
      sessionId: "session-2",
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
      agentType: "claude:opus",
      exitCode: 1,
      postExitState: "ready_for_implementation",
      rolledBack: false,
      alternativeAgentAvailable: false,
      outcome: "non_zero_exit",
      success: false,
    }, tempDir);

    await expect(stats.readOutcomeStatsReport(tempDir)).resolves.toEqual(
      expect.objectContaining({
        version: 1,
        records: expect.arrayContaining([
          expect.objectContaining({ beatId: "foolery-1f10" }),
          expect.objectContaining({ beatId: "foolery-1f11" }),
        ]),
        summaries: [
          expect.objectContaining({
            agentType: "claude:opus",
            attempts: 2,
            successes: 1,
            failures: 1,
            successRate: 0.5,
          }),
        ],
      }),
    );
  });
});
