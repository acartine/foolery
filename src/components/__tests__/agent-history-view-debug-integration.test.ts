import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentHistorySession } from "@/lib/agent-history-types";
import { HistoryDebugPanel } from "@/components/history-debug-panel";

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

/**
 * Minimal harness that mirrors the debug-button rendering logic from
 * AgentHistoryView without pulling in react-query / zustand.
 */
function DebugButtonHarness({
  loadedSummary,
  sessions,
  debugPanelOpen,
  selectedSessionId,
}: {
  loadedSummary: { beatId: string; repoPath: string } | null;
  sessions: AgentHistorySession[];
  debugPanelOpen: boolean;
  selectedSessionId?: string | null;
}) {
  const selectedSession =
    sessions.find((session) => session.sessionId === selectedSessionId) ??
    sessions[0] ??
    null;

  return createElement(
    "div",
    null,
    loadedSummary && sessions.length > 0
      ? createElement(
          "button",
          { "data-testid": "debug-button" },
          debugPanelOpen ? "Close Debug" : "Debug",
        )
      : null,
    loadedSummary && sessions.length > 0
      ? createElement(
          "div",
          { "data-testid": "conversation-selector" },
          sessions.map((session, index) =>
            createElement(
              "button",
              {
                key: session.sessionId,
                "data-selected": session.sessionId === selectedSession?.sessionId ? "true" : "false",
              },
              `#${index + 1} ${session.sessionId}`,
            ),
          ),
        )
      : null,
    debugPanelOpen && selectedSession && loadedSummary
      ? createElement(HistoryDebugPanel, {
          beatId: loadedSummary.beatId,
          session: selectedSession,
          repoPath: loadedSummary.repoPath,
          beatTitle: "Test beat",
        })
      : null,
  );
}

describe("AgentHistoryView debug integration", () => {
  const summary = { beatId: "foolery-70ec", repoPath: "/tmp/foolery" };
  const sessions = [
    makeSession(),
    makeSession({
      sessionId: "history-session-2",
      interactionType: "direct",
    }),
  ];

  it("does not render the debug button when no sessions are loaded", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions: [],
        debugPanelOpen: false,
      }),
    );
    expect(html).not.toContain("debug-button");
    expect(html).not.toContain("Debug");
  });

  it("does not render the debug button when loadedSummary is null", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: null,
        sessions,
        debugPanelOpen: false,
      }),
    );
    expect(html).not.toContain("debug-button");
  });

  it("renders the debug button when sessions are loaded", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        debugPanelOpen: false,
      }),
    );
    expect(html).toContain("debug-button");
    expect(html).toContain(">Debug<");
  });

  it("shows 'Close Debug' label when debug panel is open", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        debugPanelOpen: true,
      }),
    );
    expect(html).toContain(">Close Debug<");
  });

  it("renders HistoryDebugPanel with correct props when open", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        debugPanelOpen: true,
        selectedSessionId: "history-session-2",
      }),
    );
    expect(html).toContain("History Debugger");
    expect(html).toContain("Expected Outcome");
    expect(html).toContain("Actual Outcome");
    expect(html).toContain("Test beat");
    expect(html).toContain("history-session-2");
  });

  it("renders a conversation selector and marks the selected session", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        debugPanelOpen: false,
        selectedSessionId: "history-session-2",
      }),
    );
    expect(html).toContain("conversation-selector");
    expect(html).toContain("#1 history-session-1");
    expect(html).toContain("#2 history-session-2");
    expect(html).toContain("data-selected=\"true\"");
  });

  it("does not render HistoryDebugPanel when closed", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        debugPanelOpen: false,
      }),
    );
    expect(html).not.toContain("History Debugger");
    expect(html).not.toContain("Expected Outcome");
  });
});
