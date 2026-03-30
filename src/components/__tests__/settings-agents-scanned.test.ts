import {
  describe, expect, it,
} from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsAgentsSection } from "@/components/settings-agents-section";
import {
  ScannedAgentsList,
  filterSearchableOption,
  resolveRegisteredOptionIds,
} from "@/components/settings-agents-scanned";
import type {
  RegisteredAgent,
  ScannedAgent,
} from "@/lib/types";

function makeScannedAgent(): ScannedAgent {
  return {
    id: "internal-agent-id",
    command: "codex",
    path: "/usr/local/bin/codex",
    installed: true,
    provider: "Codex",
    options: [
      {
        id: "codex-gpt-5",
        label: "GPT 5",
        provider: "Codex",
        model: "gpt",
        version: "5",
      },
      {
        id: "codex-gpt-5-mini",
        label: "GPT 5 Mini",
        provider: "Codex",
        model: "gpt",
        flavor: "mini",
        version: "5",
      },
    ],
  };
}

describe("filterSearchableOption", () => {
  it("matches case-insensitive substrings in the item value", () => {
    expect(
      filterSearchableOption(
        "glm-4-flash",
        "GLM",
      ),
    ).toBe(1);
  });

  it("matches case-insensitive substrings in keywords", () => {
    expect(
      filterSearchableOption(
        "provider/model",
        "miniMAX",
        ["OpenAI", "MiniMax"],
      ),
    ).toBe(1);
  });

  it("returns no match for unrelated searches", () => {
    expect(
      filterSearchableOption(
        "gpt-4.1",
        "claude",
        ["OpenAI", "GPT-4.1"],
      ),
    ).toBe(0);
  });

  it("keeps all options visible when the search is cleared", () => {
    expect(
      filterSearchableOption(
        "gemini-2.5-pro",
        "   ",
        ["Google", "Gemini"],
      ),
    ).toBe(1);
  });
});

describe("resolveRegisteredOptionIds", () => {
  it("uses registered agent ids as the selected model state", () => {
    const scanned = makeScannedAgent();
    const registered: Record<string, RegisteredAgent> = {
      "codex-gpt-5-mini": {
        command: "/usr/local/bin/codex",
        provider: "Codex",
        model: "gpt",
        flavor: "mini",
        version: "5",
      },
    };

    expect(
      resolveRegisteredOptionIds(
        scanned,
        registered,
      ),
    ).toEqual(["codex-gpt-5-mini"]);
  });
});

describe("ScannedAgentsList", () => {
  it("renders the CLI path and selected model pills without legacy controls", () => {
    const scanned = makeScannedAgent();
    const registered: Record<string, RegisteredAgent> = {
      "codex-gpt-5": {
        command: scanned.path,
        provider: "Codex",
        model: "gpt",
        version: "5",
      },
      "codex-gpt-5-mini": {
        command: scanned.path,
        provider: "Codex",
        model: "gpt",
        flavor: "mini",
        version: "5",
      },
    };

    const markup = renderToStaticMarkup(
      createElement(ScannedAgentsList, {
        scanned: [scanned],
        registered,
        onToggleOption: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(markup).toContain("/usr/local/bin/codex");
    expect(markup).toContain("GPT 5");
    expect(markup).toContain("GPT 5 Mini");
    expect(markup).not.toContain("Add All");
    expect(markup).not.toContain("registered");
    expect(markup).not.toContain("internal-agent-id");
  });
});

describe("SettingsAgentsSection", () => {
  it("uses success variants for the scan and add toolbar buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingsAgentsSection, {
        agents: {},
        onAgentsChange: () => undefined,
      }),
    );

    expect(markup).toContain('data-variant="success-light"');
    expect(markup).toContain(">Scan<");
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain(">Add<");
  });
});
