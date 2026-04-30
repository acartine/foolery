/**
 * Hermetic unit tests for `syncSessionLeaseInfo` — the server-side mirror
 * that copies `entry.knotsLeaseId` and `entry.knotsLeaseAgentInfo` onto the
 * `entry.session` so HTTP responses (`listSessions`, `createSession`)
 * carry the canonical, autostamp-derived agent identity.
 *
 * See `docs/knots-agent-identity-contract.md` rule 5.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { syncSessionLeaseInfo } from "@/lib/terminal-manager-types";
import type { SessionEntry } from "@/lib/terminal-manager-types";
import type { ExecutionAgentInfo } from "@/lib/execution-port";

function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    session: {
      id: "term-1",
      beatId: "b-1",
      beatTitle: "Test",
      status: "running",
      startedAt: "2026-04-30T00:00:00Z",
    },
    process: null,
    emitter: new EventEmitter(),
    buffer: [],
    interactionLog: {
      logStdout: () => {},
      logStderr: () => {},
      logResponse: () => {},
      logPrompt: () => {},
      logEnd: () => Promise.resolve(),
      logBeatState: () => {},
      filePath: null,
    } as unknown as SessionEntry["interactionLog"],
    ...overrides,
  };
}

describe("syncSessionLeaseInfo", () => {
  it("mirrors knotsLeaseId and knotsLeaseAgentInfo onto the session", () => {
    const agentInfo: ExecutionAgentInfo = {
      agentName: "Claude",
      agentModel: "opus",
      agentVersion: "4.7",
      agentProvider: "Anthropic",
    };
    const entry = makeEntry({
      knotsLeaseId: "lease-abc",
      knotsLeaseAgentInfo: agentInfo,
    });
    syncSessionLeaseInfo(entry);
    expect(entry.session.knotsLeaseId).toBe("lease-abc");
    expect(entry.session.knotsAgentInfo).toEqual({
      agentName: "Claude",
      agentModel: "opus",
      agentVersion: "4.7",
      agentProvider: "Anthropic",
    });
  });

  it("clears session lease fields when entry's lease is undefined", () => {
    const entry = makeEntry();
    entry.session.knotsLeaseId = "stale-lease";
    entry.session.knotsAgentInfo = { agentName: "stale" };
    syncSessionLeaseInfo(entry);
    expect(entry.session.knotsLeaseId).toBeUndefined();
    expect(entry.session.knotsAgentInfo).toBeUndefined();
  });

  it("only carries the four canonical agent fields, dropping agentType", () => {
    // `agentType` is part of the lease creation payload (kno --agent-type)
    // but is not surfaced to UI consumers — they read the lease directly
    // when they need it.
    const agentInfo: ExecutionAgentInfo = {
      agentName: "Codex",
      agentModel: "gpt",
      agentVersion: "5.3",
      agentProvider: "OpenAI",
      agentType: "cli",
    };
    const entry = makeEntry({
      knotsLeaseId: "lease-c",
      knotsLeaseAgentInfo: agentInfo,
    });
    syncSessionLeaseInfo(entry);
    expect(entry.session.knotsAgentInfo).toEqual({
      agentName: "Codex",
      agentModel: "gpt",
      agentVersion: "5.3",
      agentProvider: "OpenAI",
    });
  });

  it("reflects rotation when the entry's agent info is mutated and resynced", () => {
    const entry = makeEntry({
      knotsLeaseId: "lease-1",
      knotsLeaseAgentInfo: { agentName: "Claude" },
    });
    syncSessionLeaseInfo(entry);
    expect(entry.session.knotsAgentInfo?.agentName).toBe("Claude");

    entry.knotsLeaseId = "lease-2";
    entry.knotsLeaseAgentInfo = { agentName: "Codex" };
    syncSessionLeaseInfo(entry);
    expect(entry.session.knotsLeaseId).toBe("lease-2");
    expect(entry.session.knotsAgentInfo?.agentName).toBe("Codex");
  });
});
