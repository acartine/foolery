import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendOutcomeRecord,
  readOutcomeStats,
  resolveStatsDir,
  resolveStatsPath,
  type AgentOutcomeRecord,
} from "@/lib/agent-outcome-stats";

const originalCwd = process.cwd();

function buildRecord(iteration: number): AgentOutcomeRecord {
  return {
    timestamp: `2026-03-19T12:00:${String(iteration).padStart(2, "0")}Z`,
    beatId: "foolery-1f10",
    sessionId: `session-${iteration}`,
    iteration,
    agent: {
      agentId: iteration % 2 === 0 ? "agent-a" : "agent-b",
      label: iteration % 2 === 0 ? "Claude" : "Codex",
      model: iteration % 2 === 0 ? "opus" : "gpt-5",
      version: iteration % 2 === 0 ? "4.6" : "1.0",
      command: iteration % 2 === 0 ? "claude" : "codex",
    },
    claimedState: "ready_for_implementation",
    claimedStep: "implementation",
    exitCode: iteration % 3 === 0 ? 1 : 0,
    postExitState: iteration % 2 === 0 ? "ready_for_implementation_review" : "ready_for_implementation",
    rolledBack: iteration % 3 === 0,
    alternativeAgentAvailable: true,
    success: iteration % 3 !== 0,
  };
}

afterEach(() => {
  process.chdir(originalCwd);
});

describe("agent-outcome-stats", () => {
  it("appends concurrent outcome records without losing any entries", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "agent-outcome-stats-"));
    process.chdir(tempRoot);

    const records = Array.from({ length: 24 }, (_value, index) => buildRecord(index + 1));
    await Promise.all(records.map((record) => appendOutcomeRecord(record)));

    const persisted = await readOutcomeStats();
    expect(persisted).toHaveLength(records.length);
    expect(new Set(persisted.map((record) => record.sessionId))).toHaveLength(records.length);

    const lines = (await readFile(resolveStatsPath(), "utf-8"))
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(records.length);
  });

  it("reads legacy array files for backward compatibility", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "agent-outcome-stats-legacy-"));
    process.chdir(tempRoot);

    await mkdir(resolveStatsDir(), { recursive: true });
    const legacyRecord = buildRecord(1);
    await writeFile(join(resolveStatsDir(), "agent-success-rates.json"), `${JSON.stringify([legacyRecord], null, 2)}\n`);

    await expect(readOutcomeStats()).resolves.toEqual([legacyRecord]);
  });
});
