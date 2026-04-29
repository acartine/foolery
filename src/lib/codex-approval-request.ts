import type {
  ApprovalAction,
} from "@/lib/approval-actions";
import type {
  ApprovalRequest,
} from "@/lib/approval-request-visibility";

const CODEX_APPROVAL_ACTIONS: ApprovalAction[] = [
  "approve",
  "always_approve",
  "reject",
];
const MAX_VALUE_CHARS = 320;

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requestIdKey(
  value: unknown,
): string | null {
  if (typeof value === "string") return asString(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function pickString(
  obj: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = asString(obj[key]);
    if (value) return value;
  }
  return null;
}

function renderCompact(
  value: unknown,
): string | null {
  const rendered = typeof value === "string"
    ? value.trim()
    : JSON.stringify(value);
  if (!rendered) return null;
  return rendered.length > MAX_VALUE_CHARS
    ? `${rendered.slice(0, MAX_VALUE_CHARS)}...`
    : rendered;
}

function commandDisplay(
  value: unknown,
): string | null {
  if (typeof value === "string") {
    return asString(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry))
      .join(" ")
      .trim() || null;
  }
  return null;
}

function codexReplyFields(
  id: string | null,
  actions: ApprovalAction[],
): Pick<
  ApprovalRequest,
  "requestId" | "supportedActions" | "replyTarget"
> {
  if (!id) return {};
  return {
    requestId: id,
    supportedActions: actions,
    replyTarget: {
      adapter: "codex",
      transport: "jsonrpc",
      requestId: id,
    },
  };
}

function extractCodexMcpElicitation(
  obj: Record<string, unknown>,
): ApprovalRequest | null {
  if (obj.method !== "mcpServer/elicitation/request") {
    return null;
  }
  const params = toObject(obj.params);
  const requestId = requestIdKey(obj.id);
  return {
    adapter: "codex",
    source: "mcpServer/elicitation/request",
    serverName: pickString(params, [
      "serverName",
      "server_name",
    ]) ?? undefined,
    toolName: pickString(params, [
      "toolName",
      "tool_name",
      "name",
    ]) ?? undefined,
    message: pickString(params, [
      "message",
      "prompt",
      "description",
    ]) ?? undefined,
    toolParamsDisplay: renderCompact(
      params?.tool_params_display
      ?? params?.toolParamsDisplay,
    ) ?? undefined,
    parameterSummary: renderCompact(
      params?.arguments ?? params?.params,
    ) ?? undefined,
    ...codexReplyFields(requestId, [
      "approve",
      "reject",
    ]),
    options: [],
  };
}

function extractCodexCommandApproval(
  obj: Record<string, unknown>,
): ApprovalRequest | null {
  const method = asString(obj.method);
  if (
    method !== "item/commandExecution/requestApproval" &&
    method !== "execCommandApproval"
  ) {
    return null;
  }
  const params = toObject(obj.params);
  const requestId = requestIdKey(obj.id);
  const command = commandDisplay(
    params?.command,
  );
  const cwd = pickString(params, ["cwd"]);
  const summary = [
    command ? `command=${command}` : null,
    cwd ? `cwd=${cwd}` : null,
  ].filter(Boolean).join(" ");
  return {
    adapter: "codex",
    source: method,
    toolName: "command_execution",
    message: pickString(params, ["reason"]) ?? undefined,
    parameterSummary: summary || undefined,
    toolUseId: pickString(params, [
      "itemId",
      "callId",
      "call_id",
    ]) ?? undefined,
    ...codexReplyFields(
      requestId,
      CODEX_APPROVAL_ACTIONS,
    ),
    options: [],
  };
}

function extractCodexFileChangeApproval(
  obj: Record<string, unknown>,
): ApprovalRequest | null {
  const method = asString(obj.method);
  if (
    method !== "item/fileChange/requestApproval" &&
    method !== "applyPatchApproval"
  ) {
    return null;
  }
  const params = toObject(obj.params);
  const requestId = requestIdKey(obj.id);
  return {
    adapter: "codex",
    source: method,
    toolName: "file_change",
    message: pickString(params, ["reason"]) ?? undefined,
    parameterSummary: renderCompact(
      params?.fileChanges ?? params?.changes,
    ) ?? undefined,
    toolUseId: pickString(params, [
      "itemId",
      "callId",
      "call_id",
    ]) ?? undefined,
    ...codexReplyFields(
      requestId,
      CODEX_APPROVAL_ACTIONS,
    ),
    options: [],
  };
}

export function extractCodexApprovalRequest(
  value: unknown,
): ApprovalRequest | null {
  const obj = toObject(value);
  if (!obj) return null;
  return extractCodexMcpElicitation(obj)
    ?? extractCodexCommandApproval(obj)
    ?? extractCodexFileChangeApproval(obj);
}
