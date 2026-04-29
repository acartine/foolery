/**
 * OpenCode event/part translation.
 *
 * OpenCode emits two streams of structured data:
 *
 * 1. The POST `/session/<id>/message` response body, whose
 *    `parts` array contains the message parts produced
 *    during the turn (text, reasoning, tool calls, files,
 *    snapshots, step markers).
 * 2. The GET `/event` SSE stream, whose envelopes wrap
 *    those parts in event types like `message.part.updated`
 *    plus session lifecycle events (`session.idle`,
 *    `session.error`, `step.updated`, `message.updated`,
 *    `permission.asked`, `permission.updated`).
 *
 * This module converts both into the line-shaped events
 * the session runtime feeds to the agent-adapter
 * normalizer and the terminal renderer. The translator is
 * pure: dedup of streamed tool parts (a single tool may
 * receive several `message.part.updated` events as it
 * progresses through pending → running → completed) is
 * the caller's responsibility — see
 * `opencode-http-session.ts`.
 */

interface OpenCodePart {
  type: string;
  [key: string]: unknown;
}

interface OpenCodeMessageResponse {
  info?: Record<string, unknown>;
  parts?: OpenCodePart[];
  events?: unknown[];
  stream?: unknown[];
  items?: unknown[];
}

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function asOptionalString(
  value: unknown,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function findPartContainer(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  return toObject(event.properties)
    ?? toObject(event.data)
    ?? event;
}

function extractPart(
  event: Record<string, unknown>,
): OpenCodePart | null {
  const container = findPartContainer(event);
  const candidate = toObject(container?.part)
    ?? toObject(event.part);
  if (!candidate) return null;
  const type = asString(candidate.type);
  if (!type) return null;
  return candidate as OpenCodePart;
}

function extractInfo(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const container = findPartContainer(event);
  return toObject(container?.info)
    ?? toObject(event.info);
}

function permissionEvent(
  event: Record<string, unknown>,
  source: string,
): Record<string, unknown> {
  return { ...event, type: source };
}

function permissionFromName(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const name = asString(event.event)
    ?? asString(event.name);
  if (
    name === "permission.asked" ||
    name === "permission.updated"
  ) {
    return permissionEvent(event, name);
  }
  return null;
}

function permissionFromPart(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const part = toObject(event.part);
  if (!part) return null;
  const partType = asString(part.type)
    ?? asString(part.event)
    ?? asString(part.name);
  return (
    partType === "permission.asked" ||
    partType === "permission.updated"
  )
    ? permissionEvent(event, partType)
    : null;
}

function permissionEnvelope(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const type = asString(event.type);
  if (
    type === "permission.asked" ||
    type === "permission.updated"
  ) {
    return event;
  }
  return permissionFromName(event)
    ?? permissionFromPart(event);
}

function translateToolPart(
  part: OpenCodePart,
): Array<Record<string, unknown>> {
  const state = toObject(part.state) ?? {};
  const id = asString(part.id)
    ?? asString(part.callID)
    ?? asString(part.callId);
  const name = asString(part.tool)
    ?? asString(part.name)
    ?? "tool";
  const input = toObject(state.input) ?? {};
  const status = asOptionalString(state.status);
  const out: Array<Record<string, unknown>> = [];
  out.push({
    type: "tool_use",
    ...(id ? { id } : {}),
    name,
    input,
    ...(status ? { status } : {}),
  });
  if (state.output !== undefined && status !== "pending") {
    out.push({
      type: "tool_result",
      ...(id ? { tool_use_id: id } : {}),
      content: state.output,
      ...(status ? { status } : {}),
    });
  }
  return out;
}

function translateReasoningPart(
  part: OpenCodePart,
): Record<string, unknown> {
  return {
    type: "reasoning",
    text: asString(part.text) ?? "",
  };
}

function translateFilePart(
  part: OpenCodePart,
): Record<string, unknown> {
  return {
    type: "file",
    filename: asString(part.filename) ?? "",
    mime: asOptionalString(part.mime),
    source: asOptionalString(part.source),
  };
}

function translateSnapshotPart(
  part: OpenCodePart,
): Record<string, unknown> {
  return {
    type: "snapshot",
    snapshot: asString(part.snapshot) ?? "",
  };
}

/**
 * Translate a single OpenCode message part into one or
 * more Foolery-shaped event objects.
 *
 * Returns an array because a single tool part with
 * `state.output` produces both a tool_use and a
 * tool_result event in stream order. Most parts produce
 * a single event; unknown parts produce zero.
 */
export function translateOpenCodePart(
  part: OpenCodePart,
): Array<Record<string, unknown>> {
  const type = part.type;
  if (type === "step-start") return [{ type: "step_start" }];
  if (type === "text") {
    return [{
      type: "text",
      part: { text: asString(part.text) ?? "" },
    }];
  }
  if (type === "step-finish") {
    return [{
      type: "step_finish",
      part: {
        reason: asString(part.reason) ?? "stop",
      },
    }];
  }
  if (type === "tool") return translateToolPart(part);
  if (type === "reasoning") {
    return [translateReasoningPart(part)];
  }
  if (type === "file") return [translateFilePart(part)];
  if (type === "snapshot") {
    return [translateSnapshotPart(part)];
  }

  // Permission events can arrive as parts inside the
  // POST response — preserve historical shape forwarding.
  const perm = permissionEnvelope(part as Record<string, unknown>);
  return perm ? [perm] : [];
}

function translateMessagePartUpdated(
  event: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const part = extractPart(event);
  return part ? translateOpenCodePart(part) : [];
}

function translateMessageUpdated(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const info = extractInfo(event) ?? {};
  return { type: "message_updated", info };
}

function translateStepUpdated(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const container = findPartContainer(event);
  const step = toObject(container?.step)
    ?? toObject(event.step)
    ?? {};
  return { type: "step_updated", step };
}

function translateSessionIdle(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const container = findPartContainer(event);
  const sessionID = asString(container?.sessionID)
    ?? asString(container?.sessionId)
    ?? asString(event.sessionID)
    ?? asString(event.sessionId)
    ?? "";
  return { type: "session_idle", sessionID };
}

/**
 * `session.status` carries the `busy`/`idle` flip for a
 * session. The `idle` variant is the authoritative
 * turn-end signal — it fires after the model has fully
 * finished responding (including any internal tool
 * cycles). `busy` is informational and is not
 * surfaced to the runtime.
 *
 * Observed payload shape (probed via opencode 1.14.29
 * `/event` SSE):
 *   {"type":"session.status",
 *    "properties":{"sessionID":"...",
 *                  "status":{"type":"busy"|"idle"}}}
 */
function translateSessionStatus(
  event: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const container = findPartContainer(event);
  const status = toObject(container?.status)
    ?? toObject(event.status);
  const statusType = asString(status?.type);
  if (statusType !== "idle") return [];
  const sessionID = asString(container?.sessionID)
    ?? asString(container?.sessionId)
    ?? asString(event.sessionID)
    ?? asString(event.sessionId)
    ?? "";
  return [{ type: "session_idle", sessionID }];
}

function translateSessionError(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const container = findPartContainer(event);
  const errorObj = toObject(container?.error)
    ?? toObject(event.error)
    ?? {};
  const message = asString(errorObj.message)
    ?? asString(errorObj.name)
    ?? "OpenCode session error";
  return {
    type: "session_error",
    error: errorObj,
    message,
  };
}

const SSE_TRANSLATORS: Record<
  string,
  (event: Record<string, unknown>) =>
    Array<Record<string, unknown>> | Record<string, unknown>
> = {
  "message.part.updated": translateMessagePartUpdated,
  "message.updated": translateMessageUpdated,
  "step.updated": translateStepUpdated,
  "session.idle": translateSessionIdle,
  "session.status": translateSessionStatus,
  "session.error": translateSessionError,
};

/**
 * Translate an OpenCode SSE envelope into Foolery-shaped
 * event objects. Returns an array because
 * `message.part.updated` may produce 0, 1, or 2 events
 * (e.g. tool_use + tool_result). Permission events fall
 * through as-is for the existing approval pipeline.
 */
export function translateOpenCodeEvent(
  value: unknown,
): Array<Record<string, unknown>> {
  const event = toObject(value);
  if (!event) return [];

  const perm = permissionEnvelope(event);
  if (perm) return [perm];

  const type = asString(event.type);
  if (!type) return [];

  const handler = SSE_TRANSLATORS[type];
  if (!handler) return [];

  const out = handler(event);
  return Array.isArray(out) ? out : [out];
}

function eventCollections(
  resp: OpenCodeMessageResponse,
): unknown[][] {
  return [resp.events, resp.stream, resp.items]
    .filter(
      (value): value is unknown[] => Array.isArray(value),
    );
}

export function hasOpenCodeMessagePayload(
  resp: OpenCodeMessageResponse,
): boolean {
  return Array.isArray(resp.parts)
    || eventCollections(resp).length > 0
    || translateOpenCodeEvent(resp).length > 0;
}

export function translateOpenCodeResponse(
  resp: OpenCodeMessageResponse,
): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const part of resp.parts ?? []) {
    for (const translated of translateOpenCodePart(part)) {
      events.push(translated);
    }
  }
  for (const collection of eventCollections(resp)) {
    for (const event of collection) {
      for (const translated of translateOpenCodeEvent(event)) {
        events.push(translated);
      }
    }
  }
  for (const translated of translateOpenCodeEvent(resp)) {
    events.push(translated);
  }
  return events;
}

export type { OpenCodePart, OpenCodeMessageResponse };
