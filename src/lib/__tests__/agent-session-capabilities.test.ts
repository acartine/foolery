import { describe, it, expect } from "vitest";
import {
  resolveCapabilities,
  supportsInteractive,
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

describe("resolveCapabilities: interactive", () => {
  it("codex interactive uses jsonrpc-stdio", () => {
    const caps = resolveCapabilities("codex", true);
    expect(caps.interactive).toBe(true);
    expect(caps.promptTransport).toBe(
      "jsonrpc-stdio",
    );
    expect(caps.supportsFollowUp).toBe(true);
    expect(caps.watchdogTimeoutMs).toBe(30_000);
  });

  it("copilot interactive uses stdin-stream-json", () => {
    const caps = resolveCapabilities("copilot", true);
    expect(caps.interactive).toBe(true);
    expect(caps.promptTransport).toBe(
      "stdin-stream-json",
    );
    expect(caps.supportsFollowUp).toBe(true);
    expect(caps.supportsAskUserAutoResponse).toBe(
      true,
    );
    expect(caps.watchdogTimeoutMs).toBe(30_000);
    expect(caps.stdinDrainPolicy).toBe(
      "close-after-result",
    );
  });

  it("copilot without interactive returns one-shot", () => {
    const caps = resolveCapabilities("copilot");
    expect(caps.interactive).toBe(false);
    expect(caps.promptTransport).toBe("cli-arg");
  });

  it("opencode interactive uses http-server", () => {
    const caps = resolveCapabilities(
      "opencode", true,
    );
    expect(caps.interactive).toBe(true);
    expect(caps.promptTransport).toBe("http-server");
    expect(caps.supportsFollowUp).toBe(true);
    expect(caps.supportsAskUserAutoResponse).toBe(
      false,
    );
    expect(caps.watchdogTimeoutMs).toBe(30_000);
    expect(caps.stdinDrainPolicy).toBe(
      "close-after-result",
    );
  });

  it("interactive flag ignored for unsupported dialects", () => {
    const caps = resolveCapabilities("gemini", true);
    expect(caps.interactive).toBe(false);
    expect(caps.promptTransport).toBe("cli-arg");
  });
});

describe("supportsInteractive", () => {
  it("returns true for codex, copilot, opencode", () => {
    expect(supportsInteractive("codex")).toBe(true);
    expect(supportsInteractive("copilot")).toBe(true);
    expect(supportsInteractive("opencode")).toBe(true);
  });

  it("returns false for other dialects", () => {
    expect(supportsInteractive("claude")).toBe(false);
    expect(supportsInteractive("gemini")).toBe(false);
  });
});
