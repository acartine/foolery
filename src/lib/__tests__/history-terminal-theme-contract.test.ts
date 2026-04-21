import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";

function readSource(
  relativePath: string,
): string {
  return readFileSync(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
}

function readThemedComponents(): string {
  return [
    "src/components/agent-history-conversation-log.tsx",
    "src/components/agent-history-session-card.tsx",
    "src/components/agent-history-response-row.tsx",
    "src/components/interaction-picker-ui.tsx",
    "src/components/interaction-filter-dropdown.tsx",
  ].map(readSource).join("\n");
}

describe(
  "history terminal theme contract",
  () => {
    const dark = getConversationLogTheme(false);
    const light = getConversationLogTheme(true);

    it("dark theme contains terminal"
      + " palette colors", () => {
      const vals = JSON.stringify(dark);
      expect(vals).toContain("#1a1a2e");
      expect(vals).toContain("#16162a");
      expect(vals).toContain("#e0e0e0");
    });

    it("light theme contains light"
      + " palette colors", () => {
      const vals = JSON.stringify(light);
      expect(vals).toContain("text-ink-900");
      expect(vals).toContain("bg-[#f8f9fa]");
      expect(vals).toContain("bg-[#f0f0f0]");
      expect(vals).toContain("text-ink-800");
    });

    it("themed components import"
      + " from theme helper", () => {
      const source = readThemedComponents();
      expect(source).toContain(
        "agent-history-conversation-log-theme",
      );
    });

    it("themed components no longer"
      + " hardcode dark hex colors", () => {
      const source = readThemedComponents();
      const hexPattern =
        /bg-\[#1a1a2e\]|bg-\[#16162a\]|text-\[#e0e0e0\]|bg-\[#101522\]/g;
      const matches = source.match(hexPattern);
      expect(matches).toBeNull();
    });

    it("preserves mono typography", () => {
      const source = readThemedComponents();
      expect(source).toContain("font-mono");
      expect(source).toContain(
        "subpixel-antialiased",
      );
    });
  },
);
