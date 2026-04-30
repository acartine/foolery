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
  model?: string,
): ReturnType<typeof createOpenCodeHttpSession> {
  const session = createOpenCodeHttpSession(
    onEvent,
    vi.fn(),
    {},
    { model },
  );
  session.processStdoutLine(
    "opencode server listening on " +
    "http://127.0.0.1:9999",
  );
  return session;
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    json: async () => value,
  };
}

function eventStreamResponse(value?: unknown) {
  const encoded = value
    ? new TextEncoder().encode(
      `data: ${JSON.stringify(value)}\n\n`,
    )
    : null;
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        if (encoded) controller.enqueue(encoded);
        controller.close();
      },
    }),
  };
}

function turnFetchMock(
  sessionId: string,
  response: unknown,
) {
  return vi.fn((url: string | URL) => {
    const target = String(url);
    if (target.endsWith("/session")) {
      return Promise.resolve(jsonResponse({ id: sessionId }));
    }
    if (target.endsWith("/event")) {
      return Promise.resolve(eventStreamResponse());
    }
    if (target.endsWith("/message")) {
      return Promise.resolve(jsonResponse(response));
    }
    return Promise.reject(new Error(`Unexpected fetch ${target}`));
  });
}

function blockedTurnFetchMock(
  sessionId: string,
  event: unknown,
) {
  return vi.fn((url: string | URL) => {
    const target = String(url);
    if (target.endsWith("/session")) {
      return Promise.resolve(jsonResponse({ id: sessionId }));
    }
    if (target.endsWith("/event")) {
      return Promise.resolve(eventStreamResponse(event));
    }
    if (target.endsWith("/message")) {
      return new Promise(() => {});
    }
    return Promise.reject(new Error(`Unexpected fetch ${target}`));
  });
}

describe("OpenCodeHttpSession approval replies", () => {
  it("responds to permission requests through OpenCode HTTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = startReadySession(vi.fn());
    const result = await session.respondToApproval(
      {
        adapter: "opencode",
        transport: "http",
        nativeSessionId: "ses_123",
        permissionId: "perm-bash-1",
      },
      "always_approve",
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9999/session/ses_123" +
        "/permissions/perm-bash-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          response: "always",
          remember: true,
        }),
      }),
    );
  });
});

describe("OpenCodeHttpSession model selection", () => {
  it("sends configured model with message turns", async () => {
    const fetchMock = turnFetchMock("ses_123", {
      parts: [{ type: "step-finish" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = startReadySession(
      vi.fn(), "openrouter/z-ai/glm-5.1",
    );
    session.startTurn(makeChild(), "hello");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:9999/session/ses_123/message",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: {
            providerID: "openrouter",
            modelID: "z-ai/glm-5.1",
          },
          parts: [{ type: "text", text: "hello" }],
        }),
      }),
    );
  });
});

describe("OpenCodeHttpSession approvals", () => {
  it("forwards permission.asked response parts", async () => {
    const onEvent = vi.fn();
    const fetchMock = turnFetchMock("ses_123", {
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
    const fetchMock = turnFetchMock("ses_456", {
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
    const fetchMock = turnFetchMock("ses_789", {
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

describe("OpenCodeHttpSession tool_use dedup", () => {
  it(
    "skips empty-input tool_use and emits the populated update",
    async () => {
      // OpenCode emits the same tool part multiple times as it
      // moves pending → running → completed. The pending event
      // arrives before `state.input` is committed, so its
      // translated `input` is `{}`. With the original
      // first-wins dedup, that empty placeholder pinned the
      // rendered "▶ tool" line with no args. The fix waits
      // for the first event whose `input` has at least one
      // key before claiming the dedup slot.
      const onEvent = vi.fn();
      const fetchMock = turnFetchMock("ses_dedup", {
        parts: [
          {
            type: "tool",
            id: "call_read_1",
            tool: "read",
            state: { status: "pending" },
          },
          {
            type: "tool",
            id: "call_read_1",
            tool: "read",
            state: {
              status: "running",
              input: { filePath: "/tmp/notes.md" },
            },
          },
        ],
      });
      vi.stubGlobal("fetch", fetchMock);

      const session = startReadySession(onEvent);
      expect(session.startTurn(makeChild(), "hello")).toBe(true);
      await vi.waitFor(() => {
        expect(onEvent).toHaveBeenCalled();
      });

      const toolUseLines = onEvent.mock.calls
        .map((c) => c[0] as string)
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((e): e is Record<string, unknown> =>
          !!e && e.type === "tool_use"
            && e.id === "call_read_1");

      expect(toolUseLines).toHaveLength(1);
      expect(toolUseLines[0]).toMatchObject({
        type: "tool_use",
        id: "call_read_1",
        name: "read",
        input: { filePath: "/tmp/notes.md" },
      });
    },
  );
});

describe("OpenCodeHttpSession event stream approvals", () => {
  it("forwards permission.asked before message returns", async () => {
    const onEvent = vi.fn();
    const fetchMock = blockedTurnFetchMock("ses_live", {
      type: "permission.asked",
      properties: {
        id: "perm-live-1",
        sessionID: "ses_live",
        permission: "bash",
        patterns: [
          "mkdir -p .approval-validation",
          "echo token > .approval-validation/opencode.txt",
        ],
      },
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
      properties: {
        id: "perm-live-1",
        sessionID: "ses_live",
      },
    });
  });
});
