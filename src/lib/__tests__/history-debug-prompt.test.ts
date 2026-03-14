import { describe, expect, it } from "vitest";
import type { AgentHistorySession } from "@/lib/agent-history-types";
import {
  buildDebugPrompt,
  summarizeSessionEntries,
} from "@/lib/history-debug-prompt";

function makeSession(
  overrides: Partial<AgentHistorySession> = {},
): AgentHistorySession {
  return {
    sessionId: "session-123",
    interactionType: "take",
    repoPath: "/tmp/foolery",
    beatIds: ["foolery-70ec"],
    startedAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:05:00.000Z",
    entries: [],
    agentName: "codex",
    agentModel: "gpt-5",
    agentVersion: "2026.03",
    ...overrides,
  };
}

describe("summarizeSessionEntries", () => {
  it("renders prompt and parsed assistant response entries", () => {
    const summary = summarizeSessionEntries([
      {
        id: "start",
        kind: "session_start",
        ts: "2026-03-14T10:00:00.000Z",
      },
      {
        id: "prompt-1",
        kind: "prompt",
        ts: "2026-03-14T10:00:01.000Z",
        prompt: "Investigate why terminal launch failed.",
        promptSource: "initial",
        promptNumber: 1,
        workflowState: "implementation",
      },
      {
        id: "response-1",
        kind: "response",
        ts: "2026-03-14T10:00:02.000Z",
        raw: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "I found the failing API call." },
              {
                type: "tool_use",
                name: "open_file",
                input: { file_path: "/tmp/foolery/src/app.tsx" },
              },
            ],
          },
        }),
        status: "completed",
      },
      {
        id: "end",
        kind: "session_end",
        ts: "2026-03-14T10:00:03.000Z",
        status: "completed",
        exitCode: 0,
      },
    ]);

    expect(summary).toContain("Session started");
    expect(summary).toContain("Prompt #1 | initial | implementation");
    expect(summary).toContain("Investigate why terminal launch failed.");
    expect(summary).toContain("Response | completed");
    expect(summary).toContain("I found the failing API call.");
    expect(summary).toContain("tool:open_file /tmp/foolery/src/app.tsx");
    expect(summary).toContain("Session ended with status completed, exit 0");
  });

  it("returns a fallback when the session has no entries", () => {
    expect(summarizeSessionEntries([])).toBe("No session entries were recorded.");
  });
});

describe("buildDebugPrompt", () => {
  it("builds a debugging prompt with expected and actual outcome sections", () => {
    const prompt = buildDebugPrompt({
      session: makeSession({
        entries: [
          {
            id: "prompt-1",
            kind: "prompt",
            ts: "2026-03-14T10:00:01.000Z",
            prompt: "Run the failing history debugger flow.",
            promptSource: "initial",
            promptNumber: 1,
          },
        ],
      }),
      expectedOutcome: "The terminal pane opens and the agent proposes likely fixes.",
      actualOutcome: "The request exits without opening the terminal pane.",
    });

    expect(prompt).toContain("Investigate a prior Foolery history session.");
    expect(prompt).toContain("Expected Outcome");
    expect(prompt).toContain("Actual Outcome");
    expect(prompt).toContain("The terminal pane opens and the agent proposes likely fixes.");
    expect(prompt).toContain("The request exits without opening the terminal pane.");
    expect(prompt).toContain("Session Metadata");
    expect(prompt).toContain("- Session ID: session-123");
    expect(prompt).toContain("- Agent: codex / gpt-5 / 2026.03");
    expect(prompt).toContain("Session Transcript Summary");
    expect(prompt).toContain("Prompt #1 | initial");
    expect(prompt).toContain("Offer 2-4 concrete next-step options");
    expect(prompt).toContain("Do not implement fixes or mutate knots in this response.");
  });
});
