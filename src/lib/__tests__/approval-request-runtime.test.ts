import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createSessionRuntime,
  type SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";
import {
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";

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
  return {
    stdout,
    stderr,
    stdin: interactive
      ? new PassThrough()
      : new PassThrough(),
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeConfig(
  dialect:
    | "claude"
    | "codex"
    | "copilot"
    | "gemini"
    | "opencode",
  overrides: Partial<SessionRuntimeConfig> = {},
): SessionRuntimeConfig {
  return {
    id: `${dialect}-approval-test`,
    dialect,
    capabilities: resolveCapabilities(
      dialect,
      dialect !== "claude",
    ),
    watchdogTimeoutMs: null,
    normalizeEvent: createLineNormalizer(dialect),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    ...overrides,
  };
}

function emitLine(
  child: ChildProcess,
  payload: Record<string, unknown>,
): void {
  child.stdout!.emit(
    "data",
    Buffer.from(JSON.stringify(payload) + "\n"),
  );
}

function eventTexts(
  pushEvent: ReturnType<typeof vi.fn>,
  type: "stdout" | "stderr",
): string[] {
  return pushEvent.mock.calls
    .filter(
      ([event]) =>
        (event as { type: string }).type === type,
    )
    .map(
      ([event]) =>
        (event as { data: string }).data,
    );
}

describe("approval request runtime visibility: Claude", () => {
  it("shows Claude AskUserQuestion in the live terminal", () => {
    const pushEvent = vi.fn();
    const runtime = createSessionRuntime(
      makeConfig("claude", { pushEvent }),
    );
    const child = makeChild(true);

    runtime.wireStdout(child);
    emitLine(child, {
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "tool-claude-1",
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

    const stdout = eventTexts(pushEvent, "stdout")
      .join("");
    expect(stdout).toContain(
      "FOOLERY APPROVAL REQUIRED",
    );
    expect(stdout).toContain("question=Continue?");
    expect(stdout).toContain("options=Yes");
  });
});

describe("approval request runtime visibility: Codex", () => {
  it("shows Codex elicitation requests as visible stderr", () => {
    const pushEvent = vi.fn();
    const runtime = createSessionRuntime(
      makeConfig("codex", {
        pushEvent,
        jsonrpcSession: createCodexJsonRpcSession(),
      }),
    );
    const child = makeChild(true);

    runtime.wireStdout(child);
    emitLine(child, {
      method: "mcpServer/elicitation/request",
      params: {
        serverName: "playwright",
        toolName: "browser_evaluate",
        message:
          "Allow the playwright MCP server to run tool"
          + ' "browser_evaluate"?',
        tool_params_display:
          "pageFunction=document.title()",
      },
    });

    const stderr = eventTexts(pushEvent, "stderr")
      .join("");
    expect(stderr).toContain(
      "FOOLERY APPROVAL REQUIRED",
    );
    expect(stderr).toContain(
      "serverName=playwright",
    );
    expect(stderr).toContain(
      "toolName=browser_evaluate",
    );
    expect(stderr).toContain(
      'message=Allow the playwright MCP server to run tool "browser_evaluate"?',
    );
    expect(stderr).toContain(
      "toolParamsDisplay=pageFunction=document.title()",
    );
  });
});

describe("approval request runtime visibility: Copilot", () => {
  it("shows Copilot approval prompts in the live terminal", () => {
    const pushEvent = vi.fn();
    const runtime = createSessionRuntime(
      makeConfig("copilot", { pushEvent }),
    );
    const child = makeChild(true);

    runtime.wireStdout(child);
    emitLine(child, {
      type: "user_input.requested",
      data: {
        toolCallId: "copilot-tool-1",
        question: "Pick a branch",
        choices: ["main", "feature"],
      },
    });

    const stdout = eventTexts(pushEvent, "stdout")
      .join("");
    expect(stdout).toContain(
      "FOOLERY APPROVAL REQUIRED",
    );
    expect(stdout).toContain(
      "question=Pick a branch",
    );
    expect(stdout).toContain(
      "options=main | feature",
    );
  });
});

describe("approval request runtime visibility: Gemini", () => {
  it("shows Gemini permission requests as visible stderr", () => {
    const pushEvent = vi.fn();
    const child = makeChild(true);
    const writeSpy = vi.spyOn(child.stdin!, "write");
    const runtime = createSessionRuntime(
      makeConfig("gemini", {
        pushEvent,
        acpSession: createGeminiAcpSession("/tmp"),
      }),
    );

    runtime.wireStdout(child);
    emitLine(child, {
      id: "perm-1",
      method: "session/request_permission",
      params: {
        serverName: "playwright",
        toolName: "browser_evaluate",
        message: "Allow browser_evaluate?",
        options: [{
          id: "allow-once-id",
          kind: "allow_once",
        }],
      },
    });

    const stderr = eventTexts(pushEvent, "stderr")
      .join("");
    expect(stderr).toContain(
      "FOOLERY APPROVAL REQUIRED",
    );
    expect(stderr).toContain(
      "serverName=playwright",
    );
    expect(stderr).toContain(
      "toolName=browser_evaluate",
    );
    expect(writeSpy).toHaveBeenCalled();
  });
});

describe("approval request runtime visibility: OpenCode", () => {
  it("captures and shows OpenCode permission requests", () => {
    const pushEvent = vi.fn();
    const onApprovalRequest = vi.fn();
    const runtime = createSessionRuntime(
      makeConfig("opencode", {
        pushEvent,
        onApprovalRequest,
      }),
    );
    const child = makeChild(true);

    runtime.wireStdout(child);
    emitLine(child, {
      type: "permission.updated",
      properties: {
        id: "perm-opencode-1",
        sessionID: "ses-opencode-1",
        type: "bash",
        metadata: { command: "git status --short" },
      },
    });

    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: "opencode",
        nativeSessionId: "ses-opencode-1",
        requestId: "perm-opencode-1",
      }),
    );
    const stderr = eventTexts(pushEvent, "stderr")
      .join("");
    expect(stderr).toContain(
      "FOOLERY APPROVAL REQUIRED",
    );
    expect(stderr).toContain(
      "supportedActions=approve | always_approve | reject",
    );
  });
});
