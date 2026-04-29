import type {
  ApprovalRequest,
} from "@/lib/approval-request-visibility";

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

export function extractOpenCodePermissionAsked(
  value: unknown,
): ApprovalRequest | null {
  const obj = toObject(value);
  const eventName = asString(obj?.type)
    ?? asString(obj?.event)
    ?? asString(obj?.name);
  if (!obj || eventName !== "permission.asked") {
    return null;
  }
  const candidates = requestCandidates(obj);
  const metadata = pickRequestSummary(candidates, [
    "metadata",
  ]);
  const params = pickRequestSummary(candidates, [
    "params",
    "arguments",
    "input",
    "toolArgs",
    "tool_args",
  ]);
  return {
    adapter: "opencode",
    source: "permission.asked",
    sessionId: pickRequestString(candidates, [
      "sessionID",
      "sessionId",
    ]) ?? undefined,
    requestId: pickRequestString(candidates, [
      "requestID",
      "requestId",
      "permissionID",
      "permissionId",
      "id",
    ]) ?? undefined,
    permissionName: pickRequestString(candidates, [
      "permission",
      "permissionName",
      "permission_name",
    ]) ?? undefined,
    patterns: pickRequestStrings(candidates, [
      "patterns",
      "pattern",
    ]),
    serverName: extractServerName(candidates) ?? undefined,
    toolName: extractToolName(candidates) ?? undefined,
    toolUseId: extractToolUseId(candidates) ?? undefined,
    toolParamsDisplay: pickRequestSummary(candidates, [
      "tool_params_display",
      "toolParamsDisplay",
      "toolArgumentsDisplay",
    ]) ?? undefined,
    parameterSummary: params ?? metadata ?? undefined,
    options: [],
  };
}
