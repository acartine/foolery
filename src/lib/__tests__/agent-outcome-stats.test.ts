import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendOutcomeRecord,
  readOutcomeStats,
  readOutcomeStatsReport,
  resolveStatsDir,
  resolveStatsPath,
} from "../agent-outcome-stats";

describe("agent-outcome-stats", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-outcome-stats-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("always resolves stats into the application working directory", () => {
    expect(resolveStatsDir(tempDir)).toBe(join(tempDir, ".foolery-logs"));
    expect(resolveStatsPath(tempDir)).toBe(join(tempDir, ".foolery-logs", "agent-success-rates.json"));
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
      agentType: "claude:opus",
      exitCode: 0,
      postExitState: "ready_for_implementation_review",
      rolledBack: false,
      alternativeAgentAvailable: true,
      outcome: "advanced_to_next_queue",
      success: true,
    }, tempDir);

    await expect(readOutcomeStats(tempDir)).resolves.toEqual([
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
      agentType: "claude:opus",
      exitCode: 0,
      postExitState: "ready_for_implementation_review",
      rolledBack: false,
      alternativeAgentAvailable: true,
      outcome: "advanced_to_next_queue",
      success: true,
    }, tempDir);

    await appendOutcomeRecord({
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

    await expect(readOutcomeStatsReport(tempDir)).resolves.toEqual(
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
