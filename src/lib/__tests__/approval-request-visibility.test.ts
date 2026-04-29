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

  it("documents that OpenCode exposes no approval fixture in the current adapter", () => {
    // OpenCode's current HTTP adapter only forwards text and step-finish
    // parts. There is no approval/request event shape to surface today.
    const request = extractApprovalRequest({
      type: "text",
      part: { text: "working" },
    });

    expect(request).toBeNull();
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
});
