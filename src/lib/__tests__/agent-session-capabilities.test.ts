import { describe, it, expect } from "vitest";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import type {
  AgentDialect,
} from "@/lib/agent-adapter";

describe("resolveCapabilities", () => {
  it("claude is interactive with stdin-stream-json", () => {
    const caps = resolveCapabilities("claude");
    expect(caps.interactive).toBe(true);
    expect(caps.promptTransport).toBe(
      "stdin-stream-json",
    );
    expect(caps.supportsFollowUp).toBe(true);
    expect(caps.supportsAskUserAutoResponse).toBe(true);
    expect(caps.stdinDrainPolicy).toBe(
      "close-after-result",
    );
  });

  it("codex is one-shot with cli-arg", () => {
    const caps = resolveCapabilities("codex");
    expect(caps.interactive).toBe(false);
    expect(caps.promptTransport).toBe("cli-arg");
    expect(caps.supportsFollowUp).toBe(false);
    expect(caps.supportsAskUserAutoResponse).toBe(
      false,
    );
    expect(caps.stdinDrainPolicy).toBe(
      "never-opened",
    );
  });

  it("copilot is one-shot with AskUser support", () => {
    const caps = resolveCapabilities("copilot");
    expect(caps.interactive).toBe(false);
    expect(caps.promptTransport).toBe("cli-arg");
    expect(caps.supportsFollowUp).toBe(false);
    expect(caps.supportsAskUserAutoResponse).toBe(
      true,
    );
  });

  it("opencode is one-shot without AskUser", () => {
    const caps = resolveCapabilities("opencode");
    expect(caps.interactive).toBe(false);
    expect(caps.supportsAskUserAutoResponse).toBe(
      false,
    );
  });

  it("gemini is one-shot with status-result detection", () => {
    const caps = resolveCapabilities("gemini");
    expect(caps.interactive).toBe(false);
    expect(caps.promptTransport).toBe("cli-arg");
    expect(caps.supportsFollowUp).toBe(false);
    expect(caps.supportsAskUserAutoResponse).toBe(
      false,
    );
    expect(caps.resultDetection).toBe(
      "status-result",
    );
    expect(caps.stdinDrainPolicy).toBe(
      "never-opened",
    );
  });

  it("all dialects have type-result except gemini", () => {
    const dialects: AgentDialect[] = [
      "claude", "codex", "copilot", "opencode",
    ];
    for (const d of dialects) {
      expect(resolveCapabilities(d).resultDetection)
        .toBe("type-result");
    }
    expect(
      resolveCapabilities("gemini").resultDetection,
    ).toBe("status-result");
  });

  it("no dialect has a watchdog by default", () => {
    const dialects: AgentDialect[] = [
      "claude", "codex", "copilot",
      "opencode", "gemini",
    ];
    for (const d of dialects) {
      expect(
        resolveCapabilities(d).watchdogTimeoutMs,
      ).toBeNull();
    }
  });
});
