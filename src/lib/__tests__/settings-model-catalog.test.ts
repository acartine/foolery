import { describe, expect, it } from "vitest";
import { buildAgentImportOptions } from "@/lib/settings-agent-scan";

describe("current provider model catalogs", () => {
  it("offers current Codex families without advertising retired ChatGPT models", () => {
    const options = buildAgentImportOptions("codex", {});
    expect(options?.slice(0, 4).map(({ label }) => label)).toEqual([
      "Codex GPT Sol 6.1",
      "Codex GPT Astra 6",
      "Codex GPT Sol 6",
      "Codex GPT Luna 6",
    ]);
    expect(options?.some(({ modelId }) => modelId === "gpt-5.3-codex-spark")).toBe(false);
  });

  it("preserves an older configured Codex model without duplicating current choices", () => {
    const pinned = buildAgentImportOptions("codex", { modelId: "gpt-5.4" });
    expect(pinned?.[0]?.modelId).toBe("gpt-5.4");
    const current = buildAgentImportOptions("codex", { modelId: "gpt-6.1-sol" });
    expect(current?.filter(({ modelId }) => modelId === "gpt-6.1-sol")).toHaveLength(1);
  });

  it("keeps the CLI's exact Claude model IDs separate from their display labels", () => {
    const options = buildAgentImportOptions("claude", {});
    expect(options?.slice(0, 4).map(({ modelId, label }) => ({ modelId, label }))).toEqual([
      { modelId: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { modelId: "claude-fable-5-1", label: "Claude Fable 5.1" },
      { modelId: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { modelId: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    ]);
  });
});
