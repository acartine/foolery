import {
  describe,
  expect,
  it,
} from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResponseEntryRow,
} from "@/components/agent-history-response-row";
import {
  getConversationLogTheme,
} from "@/components/agent-history-conversation-log-theme";

const theme = getConversationLogTheme(false);

describe("history approval visibility", () => {
  it("renders the approval banner for persisted Codex approval requests", () => {
    const html = renderToStaticMarkup(
      createElement(ResponseEntryRow, {
        entry: {
          id: "response-1",
          kind: "response",
          ts: "2026-04-25T07:29:50.000Z",
          raw: JSON.stringify({
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
          }),
        },
        theme,
      }),
    );

    expect(html).toContain(
      "FOOLERY APPROVAL REQUIRED",
    );
    expect(html).toContain(
      "serverName=playwright",
    );
    expect(html).toContain(
      "toolName=browser_evaluate",
    );
    expect(html).toContain(
      "toolParamsDisplay=pageFunction=document.title()",
    );
  });
});
