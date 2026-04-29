import {
  describe,
  expect,
  it,
} from "vitest";
import {
  APPROVAL_REQUIRED_MARKER,
  extractApprovalRequest,
  formatApprovalRequestBanner,
} from "@/lib/approval-request-visibility";

describe("approval request fixtures", () => {
  it("extracts a Claude AskUserQuestion fixture", () => {
    const request = extractApprovalRequest({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "tool-claude-1",
          name: "AskUserQuestion",
          input: {
            questions: [{
              question: "Continue with migration?",
              options: [{ label: "Yes" }, { label: "No" }],
            }],
          },
        }],
      },
    });

    expect(request).not.toBeNull();
    expect(request?.adapter).toBe("ask-user");
    expect(request?.source).toBe("AskUserQuestion");
    expect(request?.toolUseId).toBe("tool-claude-1");
    expect(request?.question).toBe(
      "Continue with migration?",
    );
    expect(request?.options).toEqual([
      "Yes",
      "No",
    ]);
  });

  it("extracts a Codex elicitation fixture with Playwright details", () => {
    const request = extractApprovalRequest({
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

    expect(request).not.toBeNull();
    expect(request?.serverName).toBe("playwright");
    expect(request?.toolName).toBe("browser_evaluate");
    expect(request?.toolParamsDisplay).toBe(
      "pageFunction=document.title()",
    );
  });

  it("extracts a Copilot user_input.requested fixture", () => {
    const request = extractApprovalRequest({
      type: "user_input.requested",
      data: {
        toolCallId: "copilot-tool-1",
        question: "Which branch should I use?",
        choices: ["main", "feature"],
      },
    });

    expect(request).not.toBeNull();
    expect(request?.adapter).toBe("copilot");
    expect(request?.options).toEqual([
      "main",
      "feature",
    ]);
  });

  it("extracts a Gemini request_permission fixture", () => {
    const request = extractApprovalRequest({
      id: "perm-1",
      method: "session/request_permission",
      params: {
        serverName: "playwright",
        toolName: "browser_evaluate",
        message: "Allow browser_evaluate?",
        options: [{ kind: "allow_once" }],
      },
    });

    expect(request).not.toBeNull();
    expect(request?.adapter).toBe("gemini");
    expect(request?.serverName).toBe("playwright");
    expect(request?.options).toEqual(["allow_once"]);
  });
});

describe("OpenCode permission.asked extraction", () => {
  it("extracts an OpenCode bash permission.asked fixture", () => {
    const request = extractApprovalRequest({
      type: "permission.asked",
      id: "perm-bash-1",
      sessionID: "ses_opencode_1",
      permission: "bash",
      patterns: ["Bash(git status:*)"],
      metadata: {
        command: "git status --short",
      },
      tool: {
        messageID: "msg_1",
        callID: "call_bash_1",
        name: "bash",
      },
    });

    expect(request).not.toBeNull();
    expect(request?.adapter).toBe("opencode");
    expect(request?.source).toBe("permission.asked");
    expect(request?.sessionId).toBe("ses_opencode_1");
    expect(request?.requestId).toBe("perm-bash-1");
    expect(request?.permissionName).toBe("bash");
    expect(request?.patterns).toEqual([
      "Bash(git status:*)",
    ]);
    expect(request?.toolName).toBe("bash");
    expect(request?.toolUseId).toBe("call_bash_1");
    expect(request?.parameterSummary).toContain(
      "git status --short",
    );
  });

  it("extracts an OpenCode shemcp permission.asked fixture", () => {
    const request = extractApprovalRequest({
      type: "permission.asked",
      properties: {
        id: "perm-mcp-1",
        sessionID: "ses_opencode_2",
        permission: "mcp",
        patterns: ["shemcp:slack_send_message"],
        metadata: {
          serverName: "shemcp",
          toolName: "slack_send_message",
          params: {
            channel: "C123",
            text: "Release is ready",
          },
        },
        tool: {
          messageID: "msg_2",
          callID: "call_mcp_1",
        },
      },
    });

    expect(request).not.toBeNull();
    expect(request?.adapter).toBe("opencode");
    expect(request?.serverName).toBe("shemcp");
    expect(request?.toolName).toBe("slack_send_message");
    expect(request?.requestId).toBe("perm-mcp-1");
    expect(request?.toolUseId).toBe("call_mcp_1");
    expect(request?.patterns).toEqual([
      "shemcp:slack_send_message",
    ]);
  });
});

describe("OpenCode wrapped permission.asked extraction", () => {
  it("extracts fields from a permission request nested in part", () => {
    const request = extractApprovalRequest({
      type: "event",
      part: {
        type: "permission.asked",
        id: "perm-wrapped-1",
        sessionID: "ses_opencode_3",
        permission: "bash",
        patterns: ["Bash(rm:*)"],
        metadata: { command: "rm temp.txt" },
        tool: { callID: "call_wrapped_1" },
      },
    });

    expect(request).not.toBeNull();
    expect(request?.sessionId).toBe("ses_opencode_3");
    expect(request?.requestId).toBe("perm-wrapped-1");
    expect(request?.permissionName).toBe("bash");
    expect(request?.patterns).toEqual(["Bash(rm:*)"]);
    expect(request?.toolUseId).toBe("call_wrapped_1");
    expect(request?.parameterSummary).toContain(
      "rm temp.txt",
    );
  });
});

describe("formatApprovalRequestBanner", () => {
  it("includes the stable marker and greppable details", () => {
    const banner = formatApprovalRequestBanner({
      adapter: "codex",
      source: "mcpServer/elicitation/request",
      serverName: "playwright",
      toolName: "browser_evaluate",
      message: "Allow browser_evaluate?",
      toolParamsDisplay: "pageFunction=document.title()",
      options: [],
    });

    expect(banner).toContain(
      APPROVAL_REQUIRED_MARKER,
    );
    expect(banner).toContain(
      "serverName=playwright",
    );
    expect(banner).toContain(
      "toolName=browser_evaluate",
    );
    expect(banner).toContain(
      "toolParamsDisplay=pageFunction=document.title()",
    );
  });

  it("includes OpenCode routing fields", () => {
    const banner = formatApprovalRequestBanner({
      adapter: "opencode",
      source: "permission.asked",
      permissionName: "bash",
      patterns: ["Bash(git status:*)"],
      sessionId: "ses_opencode_1",
      requestId: "perm-bash-1",
      toolName: "bash",
      toolUseId: "call_bash_1",
      parameterSummary:
        '{"command":"git status --short"}',
      options: [],
    });

    expect(banner).toContain(
      "permissionName=bash",
    );
    expect(banner).toContain(
      "patterns=Bash(git status:*)",
    );
    expect(banner).toContain(
      "sessionId=ses_opencode_1",
    );
    expect(banner).toContain(
      "requestId=perm-bash-1",
    );
    expect(banner).toContain(
      "toolUseId=call_bash_1",
    );
  });
});
