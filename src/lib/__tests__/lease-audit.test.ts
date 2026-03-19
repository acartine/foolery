import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let logRoot: string;

// Mock resolveInteractionLogRoot to point at our temp dir
vi.mock("@/lib/interaction-logger", () => ({
  resolveInteractionLogRoot: () => logRoot,
}));

import {
  appendLeaseAuditEvent,
  readLeaseAuditEvents,
  aggregateLeaseAudit,
  markBeatShipped,
  resolveAuditLogRoots,
} from "@/lib/lease-audit";
import type { LeaseAuditEvent } from "@/lib/lease-audit";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lease-audit-test-"));
  logRoot = join(tempDir, "logs");
  await mkdir(logRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<LeaseAuditEvent> = {}): LeaseAuditEvent {
  return {
    timestamp: "2026-03-19T10:00:00.000Z",
    beatId: "beat-1",
    sessionId: "session-1",
    agent: { provider: "Claude", model: "claude", flavor: "opus", version: "4.5" },
    queueType: "implementation",
    outcome: "claim",
    ...overrides,
  };
}

// ── appendLeaseAuditEvent ──────────────────────────────────────

describe("appendLeaseAuditEvent", () => {
  it("creates the file and appends in JSONL format", async () => {
    const event = makeEvent();
    await appendLeaseAuditEvent(event);

    const content = await readFile(join(logRoot, "lease-audit.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      beatId: "beat-1",
      outcome: "claim",
    });
  });

  it("appends multiple events as separate lines", async () => {
    await appendLeaseAuditEvent(makeEvent({ beatId: "beat-1" }));
    await appendLeaseAuditEvent(makeEvent({ beatId: "beat-2" }));

    const content = await readFile(join(logRoot, "lease-audit.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).beatId).toBe("beat-1");
    expect(JSON.parse(lines[1]!).beatId).toBe("beat-2");
  });
});

// ── readLeaseAuditEvents ───────────────────────────────────────

describe("readLeaseAuditEvents", () => {
  it("reads back appended events", async () => {
    await appendLeaseAuditEvent(makeEvent({ beatId: "beat-1" }));
    await appendLeaseAuditEvent(makeEvent({ beatId: "beat-2" }));

    const events = await readLeaseAuditEvents([logRoot]);
    expect(events).toHaveLength(2);
    expect(events[0]!.beatId).toBe("beat-1");
    expect(events[1]!.beatId).toBe("beat-2");
  });

  it("aggregates events across multiple roots", async () => {
    const root2 = join(tempDir, "logs2");
    await mkdir(root2, { recursive: true });

    await appendLeaseAuditEvent(makeEvent({ beatId: "beat-1" }));
    // Write directly to root2
    const event2 = makeEvent({ beatId: "beat-2" });
    await writeFile(
      join(root2, "lease-audit.jsonl"),
      JSON.stringify(event2) + "\n",
      "utf-8",
    );

    const events = await readLeaseAuditEvents([logRoot, root2]);
    expect(events).toHaveLength(2);
    const beatIds = events.map((e) => e.beatId);
    expect(beatIds).toContain("beat-1");
    expect(beatIds).toContain("beat-2");
  });

  it("returns empty array for missing file", async () => {
    const emptyRoot = join(tempDir, "empty");
    await mkdir(emptyRoot, { recursive: true });
    const events = await readLeaseAuditEvents([emptyRoot]);
    expect(events).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    await writeFile(join(logRoot, "lease-audit.jsonl"), "", "utf-8");
    const events = await readLeaseAuditEvents([logRoot]);
    expect(events).toEqual([]);
  });

  it("gracefully skips malformed lines", async () => {
    const content = [
      JSON.stringify(makeEvent({ beatId: "good-1" })),
      "not valid json {{{",
      '{"incomplete": true}',
      JSON.stringify(makeEvent({ beatId: "good-2" })),
    ].join("\n") + "\n";
    await writeFile(join(logRoot, "lease-audit.jsonl"), content, "utf-8");

    const events = await readLeaseAuditEvents([logRoot]);
    expect(events).toHaveLength(2);
    expect(events[0]!.beatId).toBe("good-1");
    expect(events[1]!.beatId).toBe("good-2");
  });
});

// ── aggregateLeaseAudit ────────────────────────────────────────

describe("aggregateLeaseAudit", () => {
  it("groups by agent/queueType/outcome/date", () => {
    const events: LeaseAuditEvent[] = [
      makeEvent({ timestamp: "2026-03-19T10:00:00Z", outcome: "claim" }),
      makeEvent({ timestamp: "2026-03-19T11:00:00Z", outcome: "claim" }),
      makeEvent({ timestamp: "2026-03-19T12:00:00Z", outcome: "success" }),
      makeEvent({ timestamp: "2026-03-20T10:00:00Z", outcome: "claim" }),
    ];

    const aggregates = aggregateLeaseAudit(events);

    const claimDay19 = aggregates.find(
      (a) => a.date === "2026-03-19" && a.outcome === "claim",
    );
    expect(claimDay19).toBeDefined();
    expect(claimDay19!.count).toBe(2);

    const successDay19 = aggregates.find(
      (a) => a.date === "2026-03-19" && a.outcome === "success",
    );
    expect(successDay19).toBeDefined();
    expect(successDay19!.count).toBe(1);

    const claimDay20 = aggregates.find(
      (a) => a.date === "2026-03-20" && a.outcome === "claim",
    );
    expect(claimDay20).toBeDefined();
    expect(claimDay20!.count).toBe(1);
  });

  it("separates different agents into distinct aggregates", () => {
    const events: LeaseAuditEvent[] = [
      makeEvent({
        agent: { provider: "Claude", model: "claude", flavor: "opus" },
        outcome: "claim",
      }),
      makeEvent({
        agent: { provider: "OpenAI", model: "gpt", flavor: "codex" },
        outcome: "claim",
      }),
    ];

    const aggregates = aggregateLeaseAudit(events);
    expect(aggregates).toHaveLength(2);
  });

  it("separates different queue types", () => {
    const events: LeaseAuditEvent[] = [
      makeEvent({ queueType: "implementation", outcome: "claim" }),
      makeEvent({ queueType: "review", outcome: "claim" }),
    ];

    const aggregates = aggregateLeaseAudit(events);
    expect(aggregates).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateLeaseAudit([])).toEqual([]);
  });
});

// ── markBeatShipped ────────────────────────────────────────────

describe("markBeatShipped", () => {
  it("attributes success to last claimant and fail to others", async () => {
    const agentA = { provider: "Claude", model: "claude", flavor: "opus" };
    const agentB = { provider: "OpenAI", model: "gpt", flavor: "codex" };

    await appendLeaseAuditEvent(
      makeEvent({
        beatId: "beat-ship",
        timestamp: "2026-03-19T10:00:00Z",
        agent: agentA,
        sessionId: "s1",
        queueType: "implementation",
        outcome: "claim",
      }),
    );
    await appendLeaseAuditEvent(
      makeEvent({
        beatId: "beat-ship",
        timestamp: "2026-03-19T11:00:00Z",
        agent: agentB,
        sessionId: "s2",
        queueType: "implementation",
        outcome: "claim",
      }),
    );

    await markBeatShipped("beat-ship");

    const events = await readLeaseAuditEvents([logRoot]);
    const outcomes = events.filter((e) => e.outcome !== "claim");
    expect(outcomes).toHaveLength(2);

    const successEvents = outcomes.filter((e) => e.outcome === "success");
    const failEvents = outcomes.filter((e) => e.outcome === "fail");

    expect(successEvents).toHaveLength(1);
    expect(successEvents[0]!.agent.provider).toBe("OpenAI");

    expect(failEvents).toHaveLength(1);
    expect(failEvents[0]!.agent.provider).toBe("Claude");
  });

  it("handles multiple queue types independently", async () => {
    const agentA = { provider: "Claude", model: "claude" };
    const agentB = { provider: "OpenAI", model: "gpt" };

    await appendLeaseAuditEvent(
      makeEvent({
        beatId: "beat-multi",
        timestamp: "2026-03-19T10:00:00Z",
        agent: agentA,
        queueType: "implementation",
        outcome: "claim",
      }),
    );
    await appendLeaseAuditEvent(
      makeEvent({
        beatId: "beat-multi",
        timestamp: "2026-03-19T10:00:00Z",
        agent: agentB,
        queueType: "review",
        outcome: "claim",
      }),
    );

    await markBeatShipped("beat-multi");

    const events = await readLeaseAuditEvents([logRoot]);
    const outcomes = events.filter((e) => e.outcome !== "claim");
    expect(outcomes).toHaveLength(2);

    // Both are sole claimants of their queue, so both should be success
    expect(outcomes.every((e) => e.outcome === "success")).toBe(true);
  });

  it("does nothing when no claim events exist for the beat", async () => {
    await appendLeaseAuditEvent(
      makeEvent({ beatId: "other-beat", outcome: "claim" }),
    );

    await markBeatShipped("nonexistent-beat");

    const events = await readLeaseAuditEvents([logRoot]);
    // Only the original claim event, no new events added
    expect(events).toHaveLength(1);
    expect(events[0]!.beatId).toBe("other-beat");
  });
});

// ── resolveAuditLogRoots ───────────────────────────────────────

describe("resolveAuditLogRoots", () => {
  it("includes the interaction log root when no repoPath is given", async () => {
    const roots = await resolveAuditLogRoots();
    expect(roots).toContain(logRoot);
  });
});
