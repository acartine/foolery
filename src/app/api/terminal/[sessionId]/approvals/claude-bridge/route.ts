import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/terminal-manager";
import type {
  ApprovalRequest,
} from "@/lib/approval-request-visibility";
import {
  formatApprovalRequestBanner,
} from "@/lib/approval-request-visibility";
import type {
  ApprovalEscalationStatus,
  PendingApprovalRecord,
} from "@/lib/approval-actions";
import {
  recordPendingApproval,
} from "@/lib/terminal-approval-session";
import { withServerTiming } from "@/lib/server-timing";
import type { TerminalEvent } from "@/lib/types";

const BRIDGE_TIMEOUT_MS = 55_000;
const POLL_MS = 200;
const MAX_BUFFER = 5_000;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function compact(value: unknown): string | undefined {
  const rendered = typeof value === "string"
    ? value.trim()
    : JSON.stringify(value);
  if (!rendered) return undefined;
  return rendered.length > 320
    ? `${rendered.slice(0, 320)}...`
    : rendered;
}

function isApproved(status: ApprovalEscalationStatus): boolean {
  return status === "approved" ||
    status === "always_approved";
}

function denialMessage(
  status: ApprovalEscalationStatus,
): string | null {
  if (status === "rejected") return "User rejected this tool call.";
  if (status === "dismissed") return "User dismissed this tool call.";
  if (status === "unsupported") return "Approval action was unsupported.";
  if (status === "reply_failed") return "Approval reply failed.";
  return null;
}

function approvalRequestFromBody(
  body: Record<string, unknown>,
): {
  request: ApprovalRequest;
  input: Record<string, unknown>;
} {
  const input = asRecord(body.input);
  const toolName = asString(body.tool_name)
    ?? asString(body.toolName)
    ?? "Claude tool";
  const toolUseId = asString(body.tool_use_id)
    ?? asString(body.toolUseId);
  return {
    input,
    request: {
      adapter: "claude",
      source: "permission-prompt-tool",
      message: "Claude Code requests permission to use a tool.",
      options: [],
      toolName,
      parameterSummary: compact(input),
      toolUseId,
      requestId: toolUseId,
      supportedActions: ["approve", "reject"],
      replyTarget: {
        adapter: "claude-bridge",
        transport: "stdio",
        requestId: toolUseId,
      },
    },
  };
}

function pushApprovalBanner(
  entry: NonNullable<ReturnType<typeof getSession>>,
  request: ApprovalRequest,
): void {
  const event: TerminalEvent = {
    type: "stderr",
    data: formatApprovalRequestBanner(request, true),
    timestamp: Date.now(),
  };
  if (entry.buffer.length >= MAX_BUFFER) entry.buffer.shift();
  entry.buffer.push(event);
  entry.emitter.emit("data", event);
}

async function waitForApproval(
  record: PendingApprovalRecord,
): Promise<{ behavior: "allow" } | { behavior: "deny"; message: string }> {
  const deadline = Date.now() + BRIDGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isApproved(record.status)) {
      return { behavior: "allow" };
    }
    const message = denialMessage(record.status);
    if (message) {
      return { behavior: "deny", message };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  record.status = "manual_required";
  record.updatedAt = Date.now();
  return {
    behavior: "deny",
    message: "Timed out waiting for Foolery approval.",
  };
}

function authorizeBridge(
  request: NextRequest,
  entry: NonNullable<ReturnType<typeof getSession>>,
): boolean {
  const expected = entry.approvalBridgeToken;
  if (!expected) return false;
  return request.headers.get("X-Foolery-Approval-Bridge-Token") ===
    expected;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  return withServerTiming(
    {
      route:
        "POST /api/terminal/[sessionId]/approvals/claude-bridge",
      context: { sessionId },
    },
    async ({ measure }) => {
      const entry = getSession(sessionId);
      if (!entry) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 },
        );
      }
      if (!authorizeBridge(request, entry)) {
        return NextResponse.json(
          { error: "Approval bridge token is invalid" },
          { status: 403 },
        );
      }
      const body = asRecord(await request.json().catch(() => ({})));
      const { request: approval, input } =
        approvalRequestFromBody(body);
      const record = recordPendingApproval(entry, approval);
      pushApprovalBanner(entry, approval);
      const decision = await measure(
        "wait",
        () => waitForApproval(record),
      );
      return NextResponse.json({
        data: decision.behavior === "allow"
          ? { ...decision, updatedInput: input }
          : decision,
      });
    },
  );
}
