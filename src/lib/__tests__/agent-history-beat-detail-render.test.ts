import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeatDetailContent } from "@/components/agent-history-beat-detail";
import type { AgentHistoryBeatSummary } from "@/lib/agent-history-types";
import type { Beat } from "@/lib/types";

describe("BeatDetailContent", () => {
  it("renders persisted token usage by agent", () => {
    const summary: AgentHistoryBeatSummary = {
      beatId: "beat-1",
      repoPath: "/tmp/repo",
      title: "Token usage beat",
      lastWorkedAt: "2026-02-20T12:00:00.000Z",
      sessionCount: 1,
      takeCount: 1,
      sceneCount: 0,
      directCount: 0,
      tokenUsageByAgent: [{
        agentLabel: "Codex",
        agentModel: "o3",
        agentVersion: "1.0.0",
        inputTokens: 1234,
        outputTokens: 56,
        totalTokens: 1290,
      }],
    };
    const beat: Beat = {
      id: "beat-1",
      title: "Token usage beat",
      type: "work",
      state: "implementation",
      priority: 2,
      labels: [],
      created: "2026-02-20T10:00:00.000Z",
      updated: "2026-02-20T12:00:00.000Z",
    };

    const markup = renderToStaticMarkup(
      React.createElement(BeatDetailContent, {
        beat,
        summary,
        showExpandedDetails: false,
        onCopyBeatId: () => {},
      }),
    );

    expect(markup).toContain("Token usage by agent");
    expect(markup).toContain("Codex");
    expect(markup).toContain("o3");
    expect(markup).toContain("1.0.0");
    expect(markup).toContain("total 1,290");
    expect(markup).toContain("in 1,234");
    expect(markup).toContain("out 56");
  });
});
