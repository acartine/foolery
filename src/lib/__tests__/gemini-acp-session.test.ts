/**
 * Unit tests for the Gemini ACP session adapter.
 *
 * Covers: handshake protocol, session readiness,
 * prompt queuing, session/cancel, and error handling.
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
    stdout,
    stderr,
    stdin,
    pid: 99999,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

// ── Handshake ────────────────────────────────────────

describe("gemini ACP: handshake", () => {
  it("sends initialize and session/new", () => {
    const acpSession = createGeminiAcpSession();
    const child = makeChild();
    const writeSpy = vi.spyOn(child.stdin!, "write");

    acpSession.sendHandshake(child);

    expect(writeSpy).toHaveBeenCalledTimes(2);
    const init = JSON.parse(
      writeSpy.mock.calls[0][0] as string,
    );
    expect(init.method).toBe("initialize");
    expect(init.jsonrpc).toBe("2.0");
    expect(init.params.protocolVersion).toBe(1);

    const newSession = JSON.parse(
      writeSpy.mock.calls[1][0] as string,
    );
    expect(newSession.method).toBe("session/new");
  });

  it("becomes ready after session/new response", () => {
    const acpSession = createGeminiAcpSession();
    expect(acpSession.ready).toBe(false);

    acpSession.processLine({
      id: 1,
      result: { protocolVersion: 1 },
    });
    expect(acpSession.ready).toBe(false);

    acpSession.processLine({
      id: 2,
      result: { sessionId: "sess-123" },
    });
    expect(acpSession.ready).toBe(true);
    expect(acpSession.sessionId).toBe("sess-123");
  });

  it("queues prompt until session is ready", () => {
    const acpSession = createGeminiAcpSession();
    const child = makeChild();
    const writeSpy = vi.spyOn(child.stdin!, "write");

    acpSession.sendHandshake(child);
    writeSpy.mockClear();

    const sent = acpSession.startTurn(
      child, "hello",
    );
    expect(sent).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();

    acpSession.processLine({
      id: 1,
      result: { protocolVersion: 1 },
    });
    acpSession.processLine({
      id: 2,
      result: { sessionId: "sess-abc" },
    });

    expect(writeSpy).toHaveBeenCalledOnce();
    const prompt = JSON.parse(
      writeSpy.mock.calls[0][0] as string,
    );
    expect(prompt.method).toBe("session/prompt");
    expect(prompt.params.sessionId).toBe("sess-abc");
    expect(prompt.params.prompt).toEqual([
      { type: "text", text: "hello" },
    ]);
  });
});

// ── Interrupt ────────────────────────────────────────

describe("gemini ACP: interrupt", () => {
  it("sends session/cancel", () => {
    const acpSession = createGeminiAcpSession();
    const child = makeChild();
    const writeSpy = vi.spyOn(child.stdin!, "write");

    acpSession.sendHandshake(child);
    acpSession.processLine({
      id: 1, result: { protocolVersion: 1 },
    });
    acpSession.processLine({
      id: 2, result: { sessionId: "s1" },
    });

    const interrupted =
      acpSession.interruptTurn(child);
    expect(interrupted).toBe(true);

    const cancelCall = writeSpy.mock.calls
      .map(([arg]) => {
        try {
          return JSON.parse(arg as string);
        } catch { return null; }
      })
      .find(
        (msg) => msg?.method === "session/cancel",
      );
    expect(cancelCall).toBeTruthy();
    expect(cancelCall.params.sessionId).toBe("s1");
  });

  it("returns false without session", () => {
    const acpSession = createGeminiAcpSession();
    const child = makeChild();
    expect(
      acpSession.interruptTurn(child),
    ).toBe(false);
  });
});

// ── Event translation ────────────────────────────────

describe("gemini ACP: event translation", () => {
  it("translates agent_message_chunk", () => {
    const acpSession = createGeminiAcpSession();
    const result = acpSession.processLine({
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
      type: "message",
      role: "assistant",
      content: "hi",
      delta: true,
    });
  });

  it("translates tool_call", () => {
    const acpSession = createGeminiAcpSession();
    const result = acpSession.processLine({
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
    const acpSession = createGeminiAcpSession();
    acpSession.processLine({
      id: 1, result: { protocolVersion: 1 },
    });
    acpSession.processLine({
      id: 2, result: { sessionId: "s1" },
    });
    const child = makeChild();
    acpSession.startTurn(child, "go");

    const result = acpSession.processLine({
      id: 3,
      result: { stopReason: "end_turn" },
    });
    expect(result).toEqual({
      type: "result",
      status: "success",
    });
  });

  it("translates error response to error result", () => {
    const acpSession = createGeminiAcpSession();
    acpSession.processLine({
      id: 1, result: { protocolVersion: 1 },
    });
    acpSession.processLine({
      id: 2, result: { sessionId: "s1" },
    });
    const child = makeChild();
    acpSession.startTurn(child, "fail");

    const result = acpSession.processLine({
      id: 3,
      error: { code: 429, message: "Rate limit" },
    });
    expect(result).toEqual({
      type: "result",
      status: "error",
      error: "Rate limit",
    });
  });

  it("skips unknown notifications", () => {
    const acpSession = createGeminiAcpSession();
    const result = acpSession.processLine({
      method: "unknown/method",
      params: {},
    });
    expect(result).toBeNull();
  });
});
