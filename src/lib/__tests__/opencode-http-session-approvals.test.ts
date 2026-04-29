import {
  describe,
  expect,
  it,
  vi,
  afterEach,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

function startReadySession(
  onEvent: (line: string) => void,
): ReturnType<typeof createOpenCodeHttpSession> {
  const session = createOpenCodeHttpSession(
    onEvent,
    vi.fn(),
  );
  session.processStdoutLine(
    "opencode server listening on " +
    "http://127.0.0.1:9999",
  );
  return session;
}

describe("OpenCodeHttpSession approvals", () => {
  it("forwards permission.asked response parts", async () => {
    const onEvent = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ses_123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          parts: [{
            type: "permission.asked",
            id: "perm-bash-1",
            sessionID: "ses_123",
            permission: "bash",
            patterns: ["Bash(git status:*)"],
            metadata: {
              command: "git status --short",
            },
            tool: {
              callID: "call_bash_1",
            },
          }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const session = startReadySession(onEvent);
    expect(session.startTurn(makeChild(), "hello")).toBe(true);
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledOnce();
    });

    const forwarded = JSON.parse(
      onEvent.mock.calls[0]?.[0] as string,
    ) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      type: "permission.asked",
      id: "perm-bash-1",
      sessionID: "ses_123",
      permission: "bash",
    });
  });

  it("forwards permission.asked stream events", async () => {
    const onEvent = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ses_456" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [{
            event: "permission.asked",
            properties: {
              id: "perm-mcp-1",
              sessionID: "ses_456",
              permission: "mcp",
              patterns: ["shemcp:slack_send_message"],
              metadata: {
                serverName: "shemcp",
                toolName: "slack_send_message",
              },
              tool: {
                callID: "call_mcp_1",
              },
            },
          }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const session = startReadySession(onEvent);
    expect(session.startTurn(makeChild(), "hello")).toBe(true);
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledOnce();
    });

    const forwarded = JSON.parse(
      onEvent.mock.calls[0]?.[0] as string,
    ) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      type: "permission.asked",
      event: "permission.asked",
    });
    expect(forwarded.properties).toMatchObject({
      id: "perm-mcp-1",
      sessionID: "ses_456",
    });
  });
});

describe("OpenCodeHttpSession wrapped approvals", () => {
  it("forwards wrapped permission.asked parts", async () => {
    const onEvent = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ses_789" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [{
            type: "event",
            part: {
              type: "permission.asked",
              id: "perm-wrapped-1",
              sessionID: "ses_789",
              permission: "bash",
              patterns: ["Bash(rm:*)"],
              metadata: { command: "rm temp.txt" },
              tool: { callID: "call_wrapped_1" },
            },
          }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const session = startReadySession(onEvent);
    expect(session.startTurn(makeChild(), "hello")).toBe(true);
    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledOnce();
    });

    const forwarded = JSON.parse(
      onEvent.mock.calls[0]?.[0] as string,
    ) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      type: "permission.asked",
      part: {
        id: "perm-wrapped-1",
        sessionID: "ses_789",
        permission: "bash",
      },
    });
  });
});
