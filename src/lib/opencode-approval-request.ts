import type {
  ApprovalRequest,
} from "@/lib/approval-request-visibility";
import {
  APPROVAL_ACTIONS,
} from "@/lib/approval-actions";

const MAX_VALUE_CHARS = 320;

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}

function renderCompact(
  value: unknown,
): string | null {
  if (isEmptyValue(value)) return null;
  const rendered = typeof value === "string"
    ? value.trim()
    : JSON.stringify(value);
  if (!rendered) return null;
  return rendered.length > MAX_VALUE_CHARS
    ? `${rendered.slice(0, MAX_VALUE_CHARS)}...`
    : rendered;
}

function requestCandidates(
  params: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const candidates = [params];
  const keys = [
    "request",
    "permission",
    "details",
    "tool",
    "payload",
    "properties",
    "data",
    "params",
    "metadata",
    "part",
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const source = candidates[index];
    for (const key of keys) {
      const candidate = toObject(source[key]);
      if (candidate && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function collectStrings(
  value: unknown,
): string[] {
  const direct = asString(value);
  if (direct) return [direct];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const entryDirect = asString(entry);
    if (entryDirect) return [entryDirect];
    const obj = toObject(entry);
    const label = pickString(obj, [
      "pattern",
      "glob",
      "label",
      "text",
      "id",
      "value",
    ]);
    return label ? [label] : [];
  });
}

function pickRequestString(
  candidates: Array<Record<string, unknown>>,
  keys: string[],
): string | null {
  for (const candidate of candidates) {
    const value = pickString(candidate, keys);
    if (value) return value;
  }
  return null;
}

function pickRequestSummary(
  candidates: Array<Record<string, unknown>>,
  keys: string[],
): string | null {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = renderCompact(candidate[key]);
      if (value) return value;
    }
  }
  return null;
}

function pickRequestStrings(
  candidates: Array<Record<string, unknown>>,
  keys: string[],
): string[] {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = collectStrings(candidate[key]);
      if (value.length > 0) return value;
    }
  }
  return [];
}

function extractNestedString(
  candidates: Array<Record<string, unknown>>,
  parentKeys: string[],
  keys: string[],
): string | null {
  for (const candidate of candidates) {
    for (const parentKey of parentKeys) {
      const parent = toObject(candidate[parentKey]);
      const value = pickString(parent, keys);
      if (value) return value;
    }
  }
  return null;
}

function extractToolName(
  candidates: Array<Record<string, unknown>>,
): string | null {
  return pickRequestString(candidates, [
    "toolName",
    "tool_name",
    "requestedToolName",
    "tool",
    "name",
  ]) ?? extractNestedString(candidates, [
    "tool",
    "metadata",
  ], [
    "name",
    "toolName",
  ]);
}

function extractServerName(
  candidates: Array<Record<string, unknown>>,
): string | null {
  return pickRequestString(candidates, [
    "serverName",
    "server_name",
  ]) ?? extractNestedString(candidates, [
    "server",
    "metadata",
  ], [
    "name",
    "serverName",
  ]);
}

function extractToolUseId(
  candidates: Array<Record<string, unknown>>,
): string | null {
  return pickRequestString(candidates, [
    "toolUseId",
    "tool_use_id",
    "callID",
    "callId",
    "toolCallId",
  ]) ?? extractNestedString(candidates, [
    "tool",
    "metadata",
  ], [
    "callID",
    "callId",
    "toolCallId",
    "id",
  ]);
}

function deriveCommandDisplay(
  candidates: Array<Record<string, unknown>>,
  patterns: string[],
): string | null {
  const commandString = pickRequestString(candidates, [
    "command",
    "cmd",
    "commandLine",
    "command_line",
  ]);
  if (commandString) return commandString;
  const nestedCommand = extractNestedString(candidates, [
    "metadata",
    "params",
    "input",
    "arguments",
    "toolArgs",
    "tool_args",
    "tool",
  ], [
    "command",
    "cmd",
    "commandLine",
    "command_line",
  ]);
  if (nestedCommand) return nestedCommand;
  const argsSummary = pickRequestSummary(candidates, [
    "arguments",
    "input",
    "toolArgs",
    "tool_args",
  ]);
  if (argsSummary) return argsSummary;
  const meaningfulPattern = patterns.find((pattern) => pattern.trim());
  return meaningfulPattern ?? null;
}

export function extractOpenCodePermissionAsked(
  value: unknown,
): ApprovalRequest | null {
  const obj = toObject(value);
  const eventName = asString(obj?.type)
    ?? asString(obj?.event)
    ?? asString(obj?.name);
  const part = toObject(obj?.part);
  const partEventName = asString(part?.type)
    ?? asString(part?.event)
    ?? asString(part?.name);
  const source = [eventName, partEventName]
    .find((name) =>
      name === "permission.asked" ||
      name === "permission.updated");
  if (!obj || !source) {
    return null;
  }
  const candidates = requestCandidates(obj);
  const nativeSessionId = pickRequestString(candidates, [
    "sessionID",
    "sessionId",
  ]) ?? undefined;
  const permissionId = pickRequestString(candidates, [
    "requestID",
    "requestId",
    "permissionID",
    "permissionId",
    "id",
  ]) ?? undefined;
  const supportedActions = nativeSessionId && permissionId
    ? [...APPROVAL_ACTIONS]
    : undefined;
  const permissionName = pickRequestString(candidates, [
    "permission",
    "permissionName",
    "permission_name",
  ]) ?? pickRequestString(candidates.slice(1), [
    "type",
  ]);
  const toolName = extractToolName(candidates)
    ?? permissionName;
  const patterns = pickRequestStrings(candidates, [
    "patterns",
    "pattern",
  ]);
  const commandDisplay = deriveCommandDisplay(candidates, patterns);
  const toolParamsDisplay = pickRequestSummary(candidates, [
    "tool_params_display",
    "toolParamsDisplay",
    "toolArgumentsDisplay",
  ]) ?? commandDisplay ?? undefined;
  const parameterSummary = commandDisplay
    ?? pickRequestSummary(candidates, [
      "params",
      "arguments",
      "input",
      "toolArgs",
      "tool_args",
    ])
    ?? pickRequestSummary(candidates, ["metadata"])
    ?? undefined;
  return {
    adapter: "opencode",
    source,
    sessionId: nativeSessionId,
    nativeSessionId,
    requestId: permissionId,
    permissionId,
    permissionName: permissionName ?? undefined,
    patterns,
    serverName: extractServerName(candidates) ?? undefined,
    toolName: toolName ?? undefined,
    toolUseId: extractToolUseId(candidates) ?? undefined,
    toolParamsDisplay,
    parameterSummary,
    supportedActions,
    replyTarget: supportedActions
      ? {
        adapter: "opencode",
        transport: "http",
        nativeSessionId,
        requestId: permissionId,
        permissionId,
      }
      : undefined,
    options: [],
  };
}
