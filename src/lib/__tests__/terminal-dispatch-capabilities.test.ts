import { describe, expect, it } from "vitest";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  assertTakeSceneInteractiveCapabilities,
  resolveTakeSceneCapabilities,
  resolveTakeSceneRuntimeSelection,
  terminalDispatchKind,
  TERMINAL_DISPATCH_FAILURE_MARKER,
} from "@/lib/terminal-dispatch-capabilities";

describe("terminal take/scene dispatch capabilities", () => {
  it("uses OpenCode HTTP serve for take dispatch", () => {
    const caps = resolveTakeSceneCapabilities(
      "opencode",
      "take",
    );
    expect(caps.interactive).toBe(true);
    expect(caps.promptTransport).toBe("http-server");
  });

  it("uses OpenCode HTTP serve for scene dispatch", () => {
    const caps = resolveTakeSceneCapabilities(
      "opencode",
      "scene",
    );
    expect(caps.interactive).toBe(true);
    expect(caps.promptTransport).toBe("http-server");
  });

  it("uses Codex app-server for take dispatch", () => {
    const caps = resolveTakeSceneCapabilities(
      "codex",
      "take",
    );
    expect(caps.interactive).toBe(true);
    expect(caps.promptTransport).toBe("jsonrpc-stdio");
  });

  it("selects interactive runtime transport for custom-prompt takes", () => {
    const selection = resolveTakeSceneRuntimeSelection(
      "opencode",
      "take",
      10,
    );
    expect(selection.isInteractive).toBe(true);
    expect(selection.transport).toBe("http-server");
  });

  it("rejects one-shot capability objects for take dispatch", () => {
    expect(() =>
      assertTakeSceneInteractiveCapabilities(
        "opencode",
        "take",
        resolveCapabilities("opencode"),
      )
    ).toThrow(TERMINAL_DISPATCH_FAILURE_MARKER);
  });

  it("classifies parent sessions as scene dispatches", () => {
    expect(terminalDispatchKind(true)).toBe("scene");
    expect(terminalDispatchKind(false)).toBe("take");
  });
});
