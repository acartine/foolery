/**
 * Unit tests for the Gemini ACP session adapter.
 *
 * Covers: handshake protocol, session readiness,
 * prompt queuing, session/cancel, and event
 * translation.
 */
import {
  describe, it, expect, vi,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";

// ── Helpers ──────────────────────────────────────────

function makeChild(): ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  return {
    stdout, stderr, stdin,
    pid: 99999,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

const CWD = "/tmp";

// ── Handshake ────────────────────────────────────────

describe("gemini ACP: handshake", () => {
  it("sends initialize and session/new", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    const spy = vi.spyOn(child.stdin!, "write");

    session.sendHandshake(child);

    expect(spy).toHaveBeenCalledTimes(2);
    const init = JSON.parse(
      spy.mock.calls[0][0] as string,
    );
    expect(init.method).toBe("initialize");
    expect(init.params.protocolVersion).toBe(1);

    const newSess = JSON.parse(
      spy.mock.calls[1][0] as string,
    );
    expect(newSess.method).toBe("session/new");
    expect(newSess.params.cwd).toBe(CWD);
  });

  it("becomes ready after session/new response", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    expect(session.ready).toBe(false);

    session.processLine(child, {
      id: 1, result: { protocolVersion: 1 },
    });
    expect(session.ready).toBe(false);

    session.processLine(child, {
      id: 2, result: { sessionId: "s-123" },
    });
    expect(session.ready).toBe(true);
    expect(session.sessionId).toBe("s-123");
  });

  it("queues prompt until session is ready", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    const spy = vi.spyOn(child.stdin!, "write");

    session.sendHandshake(child);
    spy.mockClear();

    const sent = session.startTurn(child, "hello");
    expect(sent).toBe(true);
    expect(spy).not.toHaveBeenCalled();

    session.processLine(child, {
      id: 1, result: { protocolVersion: 1 },
    });
    session.processLine(child, {
      id: 2, result: { sessionId: "s-abc" },
    });

    expect(spy).toHaveBeenCalledOnce();
    const prompt = JSON.parse(
      spy.mock.calls[0][0] as string,
    );
    expect(prompt.method).toBe("session/prompt");
    expect(prompt.params.sessionId).toBe("s-abc");
    expect(prompt.params.prompt).toEqual([
      { type: "text", text: "hello" },
    ]);
  });
});

// ── Interrupt ────────────────────────────────────────

describe("gemini ACP: interrupt", () => {
  it("sends session/cancel notification", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    const spy = vi.spyOn(child.stdin!, "write");

    session.sendHandshake(child);
    session.processLine(child, {
      id: 1, result: { protocolVersion: 1 },
    });
    session.processLine(child, {
      id: 2, result: { sessionId: "s1" },
    });

    expect(session.interruptTurn(child)).toBe(true);

    const cancel = spy.mock.calls
      .map(([arg]) => {
        try {
          return JSON.parse(arg as string);
        } catch { return null; }
      })
      .find(
        (m) => m?.method === "session/cancel",
      );
    expect(cancel).toBeTruthy();
    expect(cancel.params.sessionId).toBe("s1");
    // cancel is a notification — no id
    expect(cancel.id).toBeUndefined();
  });

  it("returns false without session", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    expect(session.interruptTurn(child)).toBe(false);
  });
});

// ── Event translation ────────────────────────────────

describe("gemini ACP: event translation", () => {
  it("translates agent_message_chunk", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    const result = session.processLine(child, {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" },
        },
      },
    });
    expect(result).toEqual({
      type: "message", role: "assistant",
      content: "hi", delta: true,
    });
  });

  it("translates tool_call", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    const result = session.processLine(child, {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          title: "EditFile",
          toolCallId: "tc1",
        },
      },
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe("message");
  });

  it("translates prompt response to result", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    session.processLine(child, {
      id: 1, result: { protocolVersion: 1 },
    });
    session.processLine(child, {
      id: 2, result: { sessionId: "s1" },
    });
    session.startTurn(child, "go");

    const result = session.processLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });
    expect(result).toEqual({
      type: "result", status: "success",
    });
  });

  it("translates error to error result", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    session.processLine(child, {
      id: 1, result: { protocolVersion: 1 },
    });
    session.processLine(child, {
      id: 2, result: { sessionId: "s1" },
    });
    session.startTurn(child, "fail");

    const result = session.processLine(child, {
      id: 3,
      error: { code: 429, message: "Rate limit" },
    });
    expect(result).toEqual({
      type: "result", status: "error",
    });
  });

  it("skips unknown notifications", () => {
    const session = createGeminiAcpSession(CWD);
    const child = makeChild();
    const result = session.processLine(child, {
      method: "unknown/method",
      params: {},
    });
    expect(result).toBeNull();
  });
});
