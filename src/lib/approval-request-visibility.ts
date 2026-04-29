import {
  extractOpenCodePermissionAsked,
} from "@/lib/opencode-approval-request";
import {
  extractCodexApprovalRequest,
} from "@/lib/codex-approval-request";
import type {
  ApprovalAction,
  ApprovalReplyTarget,
} from "@/lib/approval-actions";

const MAX_VALUE_CHARS = 320;

export const APPROVAL_REQUIRED_MARKER =
  "FOOLERY APPROVAL REQUIRED";

export interface ApprovalRequest {
  adapter: string;
  source: string;
  message?: string;
  question?: string;
  options: string[];
  optionItems?: ApprovalOptionItem[];
  supportedActions?: ApprovalAction[];
  replyTarget?: ApprovalReplyTarget;
  serverName?: string;
  toolName?: string;
  toolParamsDisplay?: string;
  parameterSummary?: string;
  toolUseId?: string;
  sessionId?: string;
  nativeSessionId?: string;
  requestId?: string;
  permissionId?: string;
  permissionName?: string;
  patterns?: string[];
}

export interface ApprovalOptionItem {
  id: string;
  label: string;
  action?: ApprovalAction;
}

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

function collectOptions(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const direct = asString(entry);
    if (direct) return [direct];
    const obj = toObject(entry);
    const label = pickString(obj, [
      "label",
      "text",
      "title",
      "kind",
      "id",
      "value",
    ]);
    return label ? [label] : [];
  });
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

function firstObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  return toObject(value[0]);
}

function extractAskUserQuestion(
  value: unknown,
): ApprovalRequest | null {
  const obj = toObject(value);
  const message = toObject(obj?.message);
  const content = Array.isArray(message?.content)
    ? message.content
    : null;
  if (!content) return null;

  for (const rawBlock of content) {
    const block = toObject(rawBlock);
    if (
      !block ||
      block.type !== "tool_use" ||
      block.name !== "AskUserQuestion"
    ) {
      continue;
    }
    const input = toObject(block.input);
    const question = firstObject(input?.questions);
    return {
      adapter: "ask-user",
      source: "AskUserQuestion",
      question: pickString(question, [
        "question",
        "prompt",
        "message",
      ]) ?? undefined,
      options: collectOptions(question?.options),
      toolUseId: pickString(block, ["id"]) ?? undefined,
    };
  }

  return null;
}

function extractCopilotUserInput(
  value: unknown,
): ApprovalRequest | null {
  const obj = toObject(value);
  if (obj?.type !== "user_input.requested") {
    return null;
  }
  const data = toObject(obj.data);
  return {
    adapter: "copilot",
    source: "user_input.requested",
    question: pickString(data, [
      "question",
      "prompt",
      "message",
    ]) ?? undefined,
    options: collectOptions(data?.choices),
    toolUseId: pickString(data, [
      "toolCallId",
      "requestId",
    ]) ?? undefined,
  };
}

function requestCandidates(
  params: Record<string, unknown> | null,
): Array<Record<string, unknown>> {
  if (!params) return [];
  const candidates = [params];
  for (const key of [
    "request",
    "permission",
    "details",
    "tool",
    "payload",
  ]) {
    const candidate = toObject(params[key]);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
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

function extractRequestToolName(
  candidates: Array<Record<string, unknown>>,
): string | null {
  const name = pickRequestString(candidates, [
    "toolName",
    "tool_name",
    "requestedToolName",
    "tool",
    "name",
  ]);
  if (name) return name;
  for (const candidate of candidates) {
    const tool = toObject(candidate.tool);
    const nested = pickString(tool, ["name", "toolName"]);
    if (nested) return nested;
  }
  return null;
}

function extractRequestServerName(
  candidates: Array<Record<string, unknown>>,
): string | null {
  const serverName = pickRequestString(candidates, [
    "serverName",
    "server_name",
  ]);
  if (serverName) return serverName;
  for (const candidate of candidates) {
    const server = toObject(candidate.server);
    const nested = pickString(server, ["name", "serverName"]);
    if (nested) return nested;
  }
  return null;
}

function extractGeminiPermissionRequest(
  value: unknown,
): ApprovalRequest | null {
  const obj = toObject(value);
  if (obj?.method !== "session/request_permission") {
    return null;
  }
  const candidates = requestCandidates(
    toObject(obj.params),
  );
  return {
    adapter: "gemini",
    source: "session/request_permission",
    serverName:
      extractRequestServerName(candidates) ?? undefined,
    toolName:
      extractRequestToolName(candidates) ?? undefined,
    message: pickRequestString(candidates, [
      "message",
      "prompt",
      "reason",
      "description",
      "title",
    ]) ?? undefined,
    toolParamsDisplay: pickRequestSummary(candidates, [
      "tool_params_display",
      "toolParamsDisplay",
      "toolArgumentsDisplay",
    ]) ?? undefined,
    parameterSummary: pickRequestSummary(candidates, [
      "arguments",
      "params",
      "toolArgs",
      "tool_args",
      "details",
    ]) ?? undefined,
    options: collectOptions(
      toObject(obj.params)?.options,
    ),
  };
}

export function extractApprovalRequest(
  value: unknown,
): ApprovalRequest | null {
  return extractOpenCodePermissionAsked(value)
    ?? extractCodexApprovalRequest(value)
    ?? extractGeminiPermissionRequest(value)
    ?? extractCopilotUserInput(value)
    ?? extractAskUserQuestion(value);
}

export function shouldEmitApprovalBannerFromRaw(
  value: unknown,
): boolean {
  const obj = toObject(value);
  return extractOpenCodePermissionAsked(value) !== null
    || extractCodexApprovalRequest(value) !== null
    || obj?.method === "session/request_permission";
}

function colorize(
  value: string,
  ansi: boolean,
): string {
  return ansi
    ? `\x1b[1;31m${value}\x1b[0m`
    : value;
}

export function formatApprovalRequestBanner(
  request: ApprovalRequest,
  ansi = false,
): string {
  const lines = [
    colorize(APPROVAL_REQUIRED_MARKER, ansi),
    `adapter=${request.adapter}`,
    `source=${request.source}`,
  ];
  if (
    request.supportedActions &&
    request.supportedActions.length > 0
  ) {
    lines.push(
      `supportedActions=${request.supportedActions.join(" | ")}`,
    );
  }
  if (request.serverName) {
    lines.push(`serverName=${request.serverName}`);
  }
  if (request.toolName) {
    lines.push(`toolName=${request.toolName}`);
  }
  if (request.permissionName) {
    lines.push(`permissionName=${request.permissionName}`);
  }
  if (request.patterns && request.patterns.length > 0) {
    lines.push(`patterns=${request.patterns.join(" | ")}`);
  }
  if (request.sessionId) {
    lines.push(`sessionId=${request.sessionId}`);
  }
  if (request.nativeSessionId) {
    lines.push(`nativeSessionId=${request.nativeSessionId}`);
  }
  if (request.requestId) {
    lines.push(`requestId=${request.requestId}`);
  }
  if (request.permissionId) {
    lines.push(`permissionId=${request.permissionId}`);
  }
  if (request.message) {
    lines.push(`message=${request.message}`);
  }
  if (request.question) {
    lines.push(`question=${request.question}`);
  }
  if (request.options.length > 0) {
    lines.push(`options=${request.options.join(" | ")}`);
  }
  if (request.toolParamsDisplay) {
    lines.push(
      `toolParamsDisplay=${request.toolParamsDisplay}`,
    );
  } else if (request.parameterSummary) {
    lines.push(
      `parameterSummary=${request.parameterSummary}`,
    );
  }
  if (request.toolUseId) {
    lines.push(`toolUseId=${request.toolUseId}`);
  }
  return `${lines.join("\n")}\n`;
}
