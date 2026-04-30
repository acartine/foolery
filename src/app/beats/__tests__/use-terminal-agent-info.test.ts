/**
 * Hermetic unit tests for the lease-derived agent-info resolver.
 *
 * The hook itself wraps React Query; here we exercise the pure helper
 * `buildAgentInfoMap` plus `lookupTerminalAgentInfo` so the resolver
 * contract is locked down without spinning up a render tree.
 */
import { describe, expect, it } from "vitest";
import {
  buildAgentInfoMap,
  lookupTerminalAgentInfo,
} from "@/app/beats/use-terminal-agent-info";
import type { TerminalSession } from "@/lib/types";

function makeSession(
  overrides: Partial<TerminalSession> = {},
): TerminalSession {
  return {
    id: "term-1",
    beatId: "b-1",
    beatTitle: "Test",
    status: "running",
    startedAt: "2026-04-30T00:00:00Z",
    ...overrides,
  };
}

describe("buildAgentInfoMap", () => {
  it("returns empty map for no sessions", () => {
    expect(buildAgentInfoMap([])).toEqual(new Map());
  });

  it("skips sessions with no knotsAgentInfo", () => {
    const sessions: TerminalSession[] = [makeSession()];
    expect(buildAgentInfoMap(sessions)).toEqual(new Map());
  });

  it("indexes by sessionId when knotsAgentInfo is present", () => {
    const sessions: TerminalSession[] = [
      makeSession({
        id: "term-a",
        knotsLeaseId: "lease-a",
        knotsAgentInfo: {
          agentName: "Claude",
          agentModel: "opus",
          agentVersion: "4.7",
          agentProvider: "Anthropic",
        },
      }),
      makeSession({
        id: "term-b",
        knotsLeaseId: "lease-b",
        knotsAgentInfo: {
          agentName: "Codex",
          agentModel: "gpt",
          agentVersion: "5.3",
        },
      }),
    ];
    const map = buildAgentInfoMap(sessions);
    expect(map.size).toBe(2);
    expect(map.get("term-a")?.agentName).toBe("Claude");
    expect(map.get("term-a")?.agentVersion).toBe("4.7");
    expect(map.get("term-b")?.agentName).toBe("Codex");
  });

  it("does not fabricate fields for sessions missing the lease info", () => {
    const sessions: TerminalSession[] = [
      makeSession({ id: "stale" }),
      makeSession({
        id: "fresh",
        knotsAgentInfo: { agentName: "Claude" },
      }),
    ];
    const map = buildAgentInfoMap(sessions);
    expect(map.has("stale")).toBe(false);
    expect(map.get("fresh")?.agentName).toBe("Claude");
  });
});

describe("lookupTerminalAgentInfo", () => {
  it("returns undefined for terminals not present in the map", () => {
    const map = new Map();
    expect(
      lookupTerminalAgentInfo({ sessionId: "missing" }, map),
    ).toBeUndefined();
  });

  it("returns the canonical info for the matching sessionId", () => {
    const info = { agentName: "Gemini" };
    const map = new Map([["term-1", info]]);
    expect(
      lookupTerminalAgentInfo({ sessionId: "term-1" }, map),
    ).toEqual(info);
  });
});
