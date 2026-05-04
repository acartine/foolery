import { describe, expect, it } from "vitest";
import {
  buildOverviewLeaseInfoByBeatKey,
} from "@/app/beats/overview-lease-info";
import type { TerminalSessionAgentInfo } from "@/lib/types";
import type { ActiveTerminal } from "@/stores/terminal-store";

describe("buildOverviewLeaseInfoByBeatKey", () => {
  it("maps running terminal leases with agent metadata and session identity", () => {
    const terminal: ActiveTerminal = {
      sessionId: "session-1",
      beatId: "beat-1",
      beatTitle: "Beat one",
      beatIds: ["beat-1", "child-1"],
      repoPath: "/repo/foolery",
      status: "running",
      startedAt: "2026-05-04T08:00:00.000Z",
    };
    const agentInfo: TerminalSessionAgentInfo = {
      agentProvider: "Codex",
      agentName: "codex-gpt",
      agentModel: "gpt-5",
      agentVersion: "2026-05-01",
    };

    const info = buildOverviewLeaseInfoByBeatKey(
      [terminal],
      new Map([["session-1", agentInfo]]),
    );

    expect(info["/repo/foolery:beat-1"]).toMatchObject({
      startedAt: "2026-05-04T08:00:00.000Z",
      sessionId: "session-1",
      repoPath: "/repo/foolery",
      provider: "Codex",
      agent: "codex-gpt",
      model: "gpt-5",
      version: "2026-05-01",
    });
    expect(info["child-1"]).toBe(info["/repo/foolery:child-1"]);
  });

  it("ignores non-running terminals", () => {
    const terminal: ActiveTerminal = {
      sessionId: "session-2",
      beatId: "beat-2",
      beatTitle: "Beat two",
      status: "completed",
      startedAt: "2026-05-04T08:00:00.000Z",
    };

    expect(
      buildOverviewLeaseInfoByBeatKey([terminal], new Map()),
    ).toEqual({});
  });
});
