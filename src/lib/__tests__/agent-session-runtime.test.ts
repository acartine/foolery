import {
  describe, it, expect, vi,
  beforeEach, afterEach,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createSessionRuntime,
  type SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";

// ── Helpers ────────────────────────────────────────────

function makeInteractionLog() {
  return {
    logStdout: vi.fn(),
    logStderr: vi.fn(),
    logResponse: vi.fn(),
    logPrompt: vi.fn(),
    logEnd: vi.fn(),
    logBeatState: vi.fn(),
    filePath: null,
  } as unknown as
    import("@/lib/interaction-logger").InteractionLog;
}

function makeChild(
  interactive: boolean,
): ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = interactive
    ? new PassThrough() : null;
  return {
    stdout,
    stderr,
    stdin,
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeConfig(
  dialect: "claude" | "codex" | "gemini",
  overrides?: Partial<SessionRuntimeConfig>,
): SessionRuntimeConfig {
  const capabilities =
    resolveCapabilities(dialect);
  return {
    id: "test-session",
    dialect,
    capabilities,
    normalizeEvent:
      createLineNormalizer(dialect),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    ...overrides,
  };
}

// ── Initial state & stdin ──────────────────────────────

describe("runtime: initial state", () => {
  it("interactive dialect has open stdin", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    expect(rt.state.stdinClosed).toBe(false);
    expect(rt.state.resultObserved).toBe(false);
  });

  it("one-shot dialect has closed stdin", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    expect(rt.state.stdinClosed).toBe(true);
  });
});

describe("runtime: sendUserTurn", () => {
  it("writes to stdin for interactive", () => {
    const config = makeConfig("claude");
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    const writeSpy = vi.spyOn(
      child.stdin!, "write",
    );
    const sent = rt.sendUserTurn(
      child, "hello", "test",
    );
    expect(sent).toBe(true);
    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][0];
    const parsed = JSON.parse(written as string);
    expect(parsed.type).toBe("user");
    expect(
      parsed.message.content[0].text,
    ).toBe("hello");
  });

  it("returns false for one-shot", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    const child = makeChild(false);
    expect(
      rt.sendUserTurn(child, "hello"),
    ).toBe(false);
  });
});

describe("runtime: closeInput", () => {
  it("ends stdin and marks closed", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.closeInput(child);
    expect(rt.state.stdinClosed).toBe(true);
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it("is idempotent", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.closeInput(child);
    rt.closeInput(child);
    expect(endSpy).toHaveBeenCalledOnce();
  });
});

// ── Scheduled close & dispose ──────────────────────────

describe("runtime: scheduleInputClose", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("closes after grace period", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.scheduleInputClose(child);
    expect(endSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it("cancel prevents close", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.scheduleInputClose(child);
    rt.cancelInputClose();
    vi.advanceTimersByTime(5000);
    expect(endSpy).not.toHaveBeenCalled();
  });
});

describe("runtime: dispose", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("cancels timers and marks closed", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.scheduleInputClose(child);
    rt.dispose();
    expect(rt.state.stdinClosed).toBe(true);
    expect(rt.state.closeInputTimer).toBeNull();
  });
});

// ── Claude stdout ──────────────────────────────────────

describe("runtime: claude stdout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sets resultObserved on result event", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    const line = JSON.stringify({
      type: "result",
      result: "done",
      is_error: false,
    });
    child.stdout!.emit(
      "data", Buffer.from(line + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.exitReason).toBe(
      "result_observed",
    );
  });

  it("auto-answers AskUserQuestion", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const writeSpy = vi.spyOn(
      child.stdin!, "write",
    );
    rt.wireStdout(child);
    const askEvent = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "tool-123456789012",
          name: "AskUserQuestion",
          input: {
            questions: [{
              question: "Continue?",
              options: [{ label: "Yes" }],
            }],
          },
        }],
      },
    });
    child.stdout!.emit(
      "data", Buffer.from(askEvent + "\n"),
    );
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(
      rt.state.autoAnsweredToolUseIds.has(
        "tool-123456789012",
      ),
    ).toBe(true);
  });
});

// ── Codex stdout ───────────────────────────────────────

describe("runtime: codex stdout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not auto-answer AskUser", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "hello",
      },
    });
    child.stdout.emit(
      "data", Buffer.from(line + "\n"),
    );
    expect(
      rt.state.autoAnsweredToolUseIds.size,
    ).toBe(0);
  });

  it("normalizes turn.completed to result", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Done",
        },
      }) + "\n"),
    );
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "turn.completed",
        usage: {},
      }) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
  });
});

// ── Gemini stdout ──────────────────────────────────────

describe("runtime: gemini stdout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("normalizes message/result events", () => {
    const rt = createSessionRuntime(
      makeConfig("gemini"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "init",
        session_id: "s1",
        model: "gemini-3",
      }) + "\n"),
    );
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "message",
        role: "assistant",
        content: "Hello",
        delta: true,
      }) + "\n"),
    );
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        status: "success",
        stats: { total_tokens: 100 },
      }) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
  });

  it("treats non-success as error", () => {
    const rt = createSessionRuntime(
      makeConfig("gemini"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        status: "error",
        stats: {},
      }) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
    expect(
      rt.state.lastNormalizedEvent?.is_error,
    ).toBe(true);
  });
});

// ── onResult callback ──────────────────────────────────

describe("runtime: onResult callback", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("prevents close when returns true", () => {
    const config = makeConfig("claude", {
      onResult: () => true,
    });
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        result: "done",
        is_error: false,
      }) + "\n"),
    );
    vi.advanceTimersByTime(5000);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("schedules close when returns false", () => {
    const config = makeConfig("claude", {
      onResult: () => false,
    });
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        result: "done",
        is_error: false,
      }) + "\n"),
    );
    vi.advanceTimersByTime(2000);
    expect(endSpy).toHaveBeenCalledOnce();
  });
});

// ── Buffer & raw fallback ──────────────────────────────

describe("runtime: flushLineBuffer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("processes partial JSON in buffer", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    const partial = JSON.stringify({
      type: "result",
      result: "buffered",
      is_error: false,
    });
    child.stdout!.emit(
      "data", Buffer.from(partial),
    );
    expect(rt.state.resultObserved).toBe(false);
    rt.flushLineBuffer(child);
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.lineBuffer).toBe("");
  });
});

describe("runtime: line buffering", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("handles chunked data across calls", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    const full = JSON.stringify({
      type: "result",
      result: "done",
      is_error: false,
    });
    const half = Math.floor(full.length / 2);
    child.stdout!.emit(
      "data", Buffer.from(full.slice(0, half)),
    );
    expect(rt.state.resultObserved).toBe(false);
    child.stdout!.emit(
      "data",
      Buffer.from(full.slice(half) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
  });
});

describe("runtime: stderr and raw stdout", () => {
  it("pushes stderr events", () => {
    const pushEvent = vi.fn();
    const rt = createSessionRuntime(
      makeConfig("claude", { pushEvent }),
    );
    const child = makeChild(true);
    rt.wireStderr(child);
    child.stderr!.emit(
      "data", Buffer.from("error output"),
    );
    const stderrEvts = pushEvent.mock.calls
      .filter(
        (c: unknown[]) =>
          (c[0] as { type: string }).type ===
          "stderr",
      );
    expect(stderrEvts).toHaveLength(1);
    expect(
      (stderrEvts[0][0] as { data: string }).data,
    ).toBe("error output");
  });

  it("pushes non-JSON as raw stdout", () => {
    const pushEvent = vi.fn();
    const rt = createSessionRuntime(
      makeConfig("claude", { pushEvent }),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    child.stdout!.emit(
      "data", Buffer.from("not json\n"),
    );
    const stdoutEvts = pushEvent.mock.calls
      .filter(
        (c: unknown[]) =>
          (c[0] as { type: string }).type ===
          "stdout",
      );
    expect(stdoutEvts.length).toBeGreaterThan(0);
    expect(
      (stdoutEvts[0][0] as { data: string }).data,
    ).toBe("not json\n");
  });
});
