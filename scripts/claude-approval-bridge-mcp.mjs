#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "foolery_approval",
  version: "0.1.0",
});

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function bridgeUrl() {
  const baseUrl = requiredEnv("FOOLERY_APPROVAL_BRIDGE_BASE_URL")
    .replace(/\/$/, "");
  const sessionId = encodeURIComponent(
    requiredEnv("FOOLERY_TERMINAL_SESSION_ID"),
  );
  return `${baseUrl}/api/terminal/${sessionId}/approvals/claude-bridge`;
}

function denial(message) {
  return {
    behavior: "deny",
    message,
  };
}

async function requestApproval(args) {
  let response;
  try {
    response = await fetch(bridgeUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Foolery-Approval-Bridge-Token": requiredEnv(
          "FOOLERY_APPROVAL_BRIDGE_TOKEN",
        ),
      },
      body: JSON.stringify(args),
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "approval bridge request failed";
    return denial(message);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return denial(
      payload.error ?? `approval bridge failed: ${response.status}`,
    );
  }
  return payload.data ?? denial("approval bridge returned no decision");
}

server.registerTool(
  "ask",
  {
    title: "Foolery approval bridge",
    description: "Ask Foolery whether Claude may use a tool.",
    inputSchema: {
      tool_name: z.string().describe("Tool requesting permission"),
      input: z.record(z.string(), z.unknown())
        .describe("Original tool input"),
      tool_use_id: z.string().optional()
        .describe("Claude tool use identifier"),
    },
  },
  async (args) => ({
    content: [{
      type: "text",
      text: JSON.stringify(await requestApproval(args)),
    }],
  }),
);

await server.connect(new StdioServerTransport());
