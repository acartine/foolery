import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentOutcomeRecord,
  appendOutcomeRecord,
  readOutcomeStats,
  resolveStatsPath,
} from "@/lib/agent-outcome-stats";

function makeRecord(overrides: Partial<AgentOutcomeRecord> = {}): AgentOutcomeRecord {
  return {
    timestamp: new Date().toISOString(),
    beatId: "test-beat",
    sessionId: "test-session",
    iteration: 1,
    agent: { command: "claude" },
    claimedState: "ready_for_implementation",
    claimedStep: "implementation",
    exitCode: 0,
    postExitState: "ready_for_implementation_review",
    rolledBack: false,
    alternativeAgentAvailable: false,
    success: true,
    ...overrides,
  };
}

describe("agent-outcome-stats", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "outcome-stats-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes and reads a single record in JSONL format", async () => {
    const record = makeRecord({ beatId: "b-001" });
    await appendOutcomeRecord(record, tempDir);

    const records = await readOutcomeStats(tempDir);
    expect(records).toHaveLength(1);
    expect(records[0]!.beatId).toBe("b-001");
  });

  it("appends multiple records as separate JSONL lines", async () => {
    await appendOutcomeRecord(makeRecord({ iteration: 1 }), tempDir);
    await appendOutcomeRecord(makeRecord({ iteration: 2 }), tempDir);
    await appendOutcomeRecord(makeRecord({ iteration: 3 }), tempDir);

    const records = await readOutcomeStats(tempDir);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.iteration)).toEqual([1, 2, 3]);
  });

  it("returns empty array for missing file", async () => {
    const records = await readOutcomeStats(tempDir);
    expect(records).toEqual([]);
  });

  it("skips malformed lines gracefully", async () => {
    const statsPath = resolveStatsPath(tempDir);
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(statsPath), { recursive: true });
    const validRecord = JSON.stringify(makeRecord({ beatId: "valid" }));
    await writeFile(statsPath, `${validRecord}\n{broken json\n${validRecord}\n`);

    const records = await readOutcomeStats(tempDir);
    expect(records).toHaveLength(2);
    expect(records[0]!.beatId).toBe("valid");
    expect(records[1]!.beatId).toBe("valid");
  });

  it("stats file uses .jsonl extension", () => {
    const path = resolveStatsPath(tempDir);
    expect(path).toMatch(/\.jsonl$/);
  });

  it("concurrent appends from multiple sessions do not lose records", async () => {
    const count = 20;
    const promises: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      promises.push(
        appendOutcomeRecord(
          makeRecord({ sessionId: `session-${i}`, iteration: i + 1 }),
          tempDir,
        ),
      );
    }
    await Promise.all(promises);

    const records = await readOutcomeStats(tempDir);
    expect(records).toHaveLength(count);

    // Verify all session IDs are present (no dropped records)
    const sessionIds = new Set(records.map((r) => r.sessionId));
    for (let i = 0; i < count; i++) {
      expect(sessionIds.has(`session-${i}`)).toBe(true);
    }
  });

  it("each JSONL line is a complete JSON object", async () => {
    await appendOutcomeRecord(makeRecord({ beatId: "line-check" }), tempDir);

    const raw = await readFile(resolveStatsPath(tempDir), "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });
});
