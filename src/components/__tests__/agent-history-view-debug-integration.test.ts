import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AgentHistorySession,
} from "@/lib/agent-history-types";
import {
  HistoryDebugPanel,
} from "@/components/history-debug-panel";

vi.mock(
  "@/hooks/use-terminal-theme-preference",
  () => ({
    useTerminalThemePreference: () => ({
      lightTheme: false,
      isLoading: false,
      isSaving: false,
      setLightTheme: vi.fn(),
    }),
  }),
);

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

function DebugButtonHarness({
  loadedSummary,
  sessions,
  activeTab,
  selectedSessionId,
}: {
  loadedSummary: {
    beatId: string;
    repoPath: string;
  } | null;
  sessions: AgentHistorySession[];
  activeTab: "console" | "debug";
  selectedSessionId?: string | null;
}) {
  const sel = sessions.find(
    (s) => s.sessionId === selectedSessionId,
  ) ?? sessions[0] ?? null;

  return createElement(
    "div",
    null,
    loadedSummary && sessions.length > 0
      ? createElement(
          "button",
          { "data-testid": "debug-button" },
          activeTab === "debug"
            ? "Close Debug"
            : "Debug",
        )
      : null,
    loadedSummary && sessions.length > 0
      ? createElement(
          "div",
          {
            "data-testid":
              "conversation-selector",
          },
          sessions.map((s, i) =>
            createElement(
              "button",
              {
                key: s.sessionId,
                "data-selected":
                  s.sessionId
                  === sel?.sessionId
                    ? "true"
                    : "false",
              },
              `#${i + 1} ${s.sessionId}`,
            ),
          ),
        )
      : null,
    activeTab === "debug"
      && sel
      && loadedSummary
      ? createElement(HistoryDebugPanel, {
          beatId: loadedSummary.beatId,
          session: sel,
          repoPath: loadedSummary.repoPath,
          beatTitle: "Test beat",
        })
      : null,
  );
}

const summary = {
  beatId: "foolery-70ec",
  repoPath: "/tmp/foolery",
};
const sessions = [
  makeSession(),
  makeSession({
    sessionId: "history-session-2",
    interactionType: "direct",
  }),
];

describe("debug button visibility", () => {
  it("hidden when no sessions", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions: [],
        activeTab: "console",
      }),
    );
    expect(html).not.toContain("debug-button");
    expect(html).not.toContain("Debug");
  });

  it("hidden when null summary", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: null,
        sessions,
        activeTab: "console",
      }),
    );
    expect(html).not.toContain("debug-button");
  });

  it("visible when sessions loaded", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        activeTab: "console",
      }),
    );
    expect(html).toContain("debug-button");
    expect(html).toContain(">Debug<");
  });
});

describe("debug tab behavior", () => {
  it("Close Debug when debug active", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        activeTab: "debug",
      }),
    );
    expect(html).toContain(">Close Debug<");
  });

  it("renders HistoryDebugPanel", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        activeTab: "debug",
        selectedSessionId: "history-session-2",
      }),
    );
    expect(html).toContain("History Debugger");
    expect(html).toContain("Expected Outcome");
    expect(html).toContain("Test beat");
  });

  it("hidden when console tab", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        activeTab: "console",
      }),
    );
    expect(html).not.toContain(
      "History Debugger",
    );
  });
});

describe("conversation selector", () => {
  it("renders and marks selected", () => {
    const html = renderToStaticMarkup(
      createElement(DebugButtonHarness, {
        loadedSummary: summary,
        sessions,
        activeTab: "console",
        selectedSessionId: "history-session-2",
      }),
    );
    expect(html).toContain(
      "conversation-selector",
    );
    expect(html).toContain(
      "#1 history-session-1",
    );
    expect(html).toContain(
      "#2 history-session-2",
    );
    expect(html).toContain(
      "data-selected=\"true\"",
    );
  });
});
