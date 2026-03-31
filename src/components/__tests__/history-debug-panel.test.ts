import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentHistorySession } from "@/lib/agent-history-types";
import {
  buildFallbackHistoryDebugPrompt,
  HistoryDebugPanel,
  launchHistoryDebugSession,
  validateHistoryDebugForm,
} from "@/components/history-debug-panel";

vi.mock("@/hooks/use-terminal-theme-preference", () => ({
  useTerminalThemePreference: () => ({
    lightTheme: false,
    isLoading: false,
    isSaving: false,
    setLightTheme: vi.fn(),
  }),
}));

function makeSession(
  overrides: Partial<AgentHistorySession> = {},
): AgentHistorySession {
  return {
    sessionId: "history-session-1",
    interactionType: "take",
    repoPath: "/tmp/foolery",
    beatIds: ["foolery-70ec"],
    startedAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:05:00.000Z",
    entries: [],
    ...overrides,
  };
}

describe("validateHistoryDebugForm", () => {
  it("requires both expected and actual outcome fields", () => {
    expect(validateHistoryDebugForm("", "actual")).toBe(
      "Expected Outcome is required.",
    );
    expect(validateHistoryDebugForm("expected", "")).toBe(
      "Actual Outcome is required.",
    );
    expect(validateHistoryDebugForm("expected", "actual")).toBeNull();
  });
});

describe("buildFallbackHistoryDebugPrompt", () => {
  it("includes the expected and actual sections plus session context", () => {
    const prompt = buildFallbackHistoryDebugPrompt({
      session: makeSession(),
      expectedOutcome: "The terminal should open.",
      actualOutcome: "The panel stayed closed.",
    });

    expect(prompt).toContain("Expected Outcome");
    expect(prompt).toContain("Actual Outcome");
    expect(prompt).toContain("The terminal should open.");
    expect(prompt).toContain("The panel stayed closed.");
    expect(prompt).toContain("Session ID: history-session-1");
    expect(prompt).toContain("Beat IDs: foolery-70ec");
  });
});

describe("HistoryDebugPanel", () => {
  it("renders the required form labels, debug button, and terminal placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(HistoryDebugPanel, {
        beatId: "foolery-70ec",
        beatTitle: "History debugger",
        session: makeSession(),
      }),
    );

    expect(html).toContain("History Debugger");
    expect(html).toContain("Expected Outcome");
    expect(html).toContain("Actual Outcome");
    expect(html).toContain(">Debug<");
    expect(html).toContain("Embedded Terminal");
    expect(html).toContain(
      "Submit the form to open a dedicated debug terminal for this conversation.",
    );
  });

  it("converts thrown startSession failures into a user-facing error result", async () => {
    const startSessionMock = vi.fn().mockRejectedValue(new Error("Network offline"));

    await expect(
      launchHistoryDebugSession(
        "foolery-70ec",
        "/tmp/foolery",
        "debug prompt",
        startSessionMock,
      ),
    ).resolves.toEqual({
      ok: false,
      error:
        "Failed to start debug session. Check the terminal service and try again. Network offline",
    });
  });
});
