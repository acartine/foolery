import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { listBeads, showBead } from "@/lib/bd";
import {
  startInteractionLog,
  noopInteractionLog,
  type InteractionLog,
} from "@/lib/interaction-logger";
import { regroomAncestors } from "@/lib/regroom";
import { getActionAgent } from "@/lib/settings";
import {
  buildPromptModeArgs,
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import type { TerminalSession, TerminalEvent } from "@/lib/types";
import { ORCHESTRATION_WAVE_LABEL } from "@/lib/wave-slugs";
import { onAgentComplete } from "@/lib/verification-orchestrator";

interface SessionEntry {
  session: TerminalSession;
  process: ChildProcess | null;
  emitter: EventEmitter;
  buffer: TerminalEvent[];
  interactionLog: InteractionLog;
}

const MAX_BUFFER = 5000;
const MAX_SESSIONS = 5;
const CLEANUP_DELAY_MS = 5 * 60 * 1000;
const INPUT_CLOSE_GRACE_MS = 2000;

type JsonObject = Record<string, unknown>;

// Use globalThis so the sessions map is shared across all Next.js route
// module instances (they each get their own module scope).
const g = globalThis as unknown as { __terminalSessions?: Map<string, SessionEntry> };
if (!g.__terminalSessions) g.__terminalSessions = new Map();
const sessions = g.__terminalSessions;

function generateId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object") return null;
  return value as JsonObject;
}

function buildAutoAskUserResponse(input: unknown): string {
  const payload = toObject(input);
  const rawQuestions = payload?.questions;
  const questions = Array.isArray(rawQuestions) ? rawQuestions : [];

  if (questions.length === 0) {
    return [
      "Ship mode auto-response (non-interactive):",
      "- No question payload was provided.",
      "- Proceed with your best assumptions and continue implementation.",
    ].join("\n");
  }

  const lines: string[] = ["Ship mode auto-response (non-interactive):"];
  for (const [index, rawQuestion] of questions.entries()) {
    const question = toObject(rawQuestion);
    const prompt =
      typeof question?.question === "string"
        ? question.question
        : `Question ${index + 1}`;
    const rawOptions = question?.options;
    const options = Array.isArray(rawOptions) ? rawOptions : [];

    if (options.length === 0) {
      lines.push(`${index + 1}. ${prompt}: no options provided; proceed with your best assumption.`);
      continue;
    }

    const firstOption = toObject(options[0]);
    const label =
      typeof firstOption?.label === "string" && firstOption.label.trim()
        ? firstOption.label.trim()
        : "first option";

    lines.push(`${index + 1}. ${prompt}: choose "${label}".`);
  }

  lines.push("Continue without waiting for additional input unless blocked by a hard error.");
  return lines.join("\n");
}

function quoteId(id: string): string {
  return JSON.stringify(id);
}

function buildVerificationStateCommand(id: string): string {
  return `bd update ${quoteId(id)} --status in_progress --add-label stage:verification`;
}

function buildSingleBeadCompletionFollowUp(beadId: string): string {
  return [
    "Ship completion follow-up:",
    `Confirm that changes for ${beadId} are merged according to your normal shipping guidelines.`,
    "Do not ask for another follow-up prompt until that merge confirmation is done (or blocked by a hard error).",
    "After confirming merge, run this command to set verification state:",
    buildVerificationStateCommand(beadId),
    "Then summarize merge confirmation and command result.",
  ].join("\n");
}

function buildWaveCompletionFollowUp(waveId: string, beatIds: string[]): string {
  const targets = beatIds.length > 0 ? beatIds : [waveId];
  return [
    "Scene completion follow-up:",
    `Handle this in one pass for scene ${waveId}.`,
    "For EACH beat below, confirm its changes are merged according to your normal shipping guidelines.",
    "Do not ask for another follow-up prompt until all listed beats are merge-confirmed (or blocked by a hard error).",
    "For each beat after merge confirmation, run exactly one command to set verification state:",
    ...targets.map((id) => buildVerificationStateCommand(id)),
    "Beats in this scene:",
    ...targets.map((id) => `- ${id}`),
    "Then summarize per beat: merged yes/no and verification-state command result.",
  ].join("\n");
}

function makeUserMessageLine(text: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  }) + "\n";
}

function compactValue(value: unknown, max = 220): string {
  const rendered =
    typeof value === "string"
      ? value
      : JSON.stringify(value);
  if (!rendered) return "";
  return rendered.length > max ? `${rendered.slice(0, max)}...` : rendered;
}

function extractEventPayload(value: unknown): {
  event: string;
  text: string;
  extras: Array<{ key: string; value: string }>;
} | null {
  const obj = toObject(value);
  if (!obj) return null;

  const eventName =
    typeof obj.event === "string"
      ? obj.event
      : typeof obj.type === "string"
        ? obj.type
        : null;
  if (!eventName) return null;

  const delta = toObject(obj.delta);
  const text =
    typeof obj.text === "string"
      ? obj.text
      : typeof obj.message === "string"
        ? obj.message
        : typeof obj.result === "string"
          ? obj.result
          : typeof obj.summary === "string"
            ? obj.summary
            : typeof delta?.text === "string"
              ? delta.text
              : "";

  const extras = Object.entries(obj)
    .filter(([key]) => !["event", "type", "text", "message", "result", "summary", "delta"].includes(key))
    .map(([key, raw]) => ({ key, value: compactValue(raw) }))
    .filter((entry) => entry.value.length > 0);

  return {
    event: eventName,
    text: text.trim(),
    extras,
  };
}

function formatEventPayload(payload: {
  event: string;
  text: string;
  extras: Array<{ key: string; value: string }>;
}): string {
  const out: string[] = [];
  out.push(`\x1b[35m${payload.event}\x1b[0m \x1b[90m|\x1b[0m ${payload.text || "(no text)"}\n`);
  for (const extra of payload.extras) {
    out.push(`\x1b[90m  ${extra.key}: ${extra.value}\x1b[0m\n`);
  }
  return out.join("");
}

function formatEventTextLines(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const hadTrailingNewline = text.endsWith("\n");
  const out: string[] = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        const payload = extractEventPayload(parsed);
        if (payload) {
          out.push(formatEventPayload(payload));
          continue;
        }
      } catch {
        // Fall through to raw line output.
      }
    }

    if (line.length > 0) out.push(`${line}\n`);
    else if (idx < lines.length - 1 || hadTrailingNewline) out.push("\n");
  }

  return out.join("");
}

export function getSession(id: string): SessionEntry | undefined {
  return sessions.get(id);
}

export function listSessions(): TerminalSession[] {
  return Array.from(sessions.values()).map((e) => e.session);
}

/** Format a stream-json event into human-readable terminal output. */
function formatStreamEvent(obj: Record<string, unknown>): string | null {
  // Assistant message content blocks
  if (obj.type === "assistant" && typeof obj.message === "object" && obj.message) {
    const msg = obj.message as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(formatEventTextLines(block.text));
      } else if (block.type === "tool_use") {
        const name = block.name as string;
        const input = block.input as Record<string, unknown> | undefined;
        // Show a short summary of what tool is being called
        let summary = "";
        if (input) {
          if (input.command) summary = ` ${String(input.command).slice(0, 120)}`;
          else if (input.file_path) summary = ` ${input.file_path}`;
          else if (input.pattern) summary = ` ${input.pattern}`;
        }
        parts.push(`\x1b[36m▶ ${name}${summary}\x1b[0m\n`);
      }
    }
    return parts.join("") || null;
  }

  if (obj.type === "stream_event") {
    const streamEvent = toObject(obj.event);
    if (!streamEvent) return null;
    const payload = extractEventPayload(streamEvent);
    if (payload) return formatEventPayload(payload);

    const delta = toObject(streamEvent.delta);
    if (typeof delta?.text === "string") {
      return formatEventTextLines(delta.text);
    }
  }

  // Tool result
  if (obj.type === "user" && typeof obj.message === "object" && obj.message) {
    const msg = obj.message as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;
    for (const block of content) {
      if (block.type === "tool_result") {
        const text = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content);
        // Show abbreviated result (first 500 chars)
        const abbrev = text.length > 500 ? text.slice(0, 500) + "...\n" : text;
        const rendered = formatEventTextLines(abbrev);
        return `\x1b[90m${rendered || abbrev}\x1b[0m\n`;
      }
    }
  }

  const adHocEvent = extractEventPayload(obj);
  if (adHocEvent) return formatEventPayload(adHocEvent);

  // Final result
  if (obj.type === "result") {
    const result = obj.result as string | undefined;
    const cost = obj.cost_usd as number | undefined;
    const dur = obj.duration_ms as number | undefined;
    const parts: string[] = [];
    if (result) parts.push(result);
    if (cost !== undefined || dur !== undefined) {
      const meta: string[] = [];
      if (cost !== undefined) meta.push(`$${cost.toFixed(4)}`);
      if (dur !== undefined) meta.push(`${(dur / 1000).toFixed(1)}s`);
      parts.push(`\x1b[90m(${meta.join(", ")})\x1b[0m`);
    }
    return parts.join(" ") + "\n";
  }

  return null;
}

export async function createSession(
  beadId: string,
  repoPath?: string,
  customPrompt?: string
): Promise<TerminalSession> {
  // Enforce max concurrent sessions
  const running = Array.from(sessions.values()).filter(
    (e) => e.session.status === "running"
  );
  if (running.length >= MAX_SESSIONS) {
    throw new Error(`Max concurrent sessions (${MAX_SESSIONS}) reached`);
  }

  // Fetch bead details for prompt
  const result = await showBead(beadId, repoPath);
  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to fetch bead");
  }
  const bead = result.data;
  const isWave = bead.labels?.includes(ORCHESTRATION_WAVE_LABEL) ?? false;
  // Check for children — both orchestrated waves and plain parent beads
  let waveBeatIds: string[] = [];
  const childResult = await listBeads({ parent: bead.id }, repoPath);
  const hasChildren = childResult.ok && childResult.data && childResult.data.length > 0;
  if (hasChildren) {
    waveBeatIds = childResult.data!
      .filter((child) => child.status !== "closed")
      .map((child) => child.id)
      .sort((a, b) => a.localeCompare(b));
  } else if (isWave) {
    console.warn(
      `[terminal-manager] Failed to load scene children for ${bead.id}: ${childResult.error ?? "no children found"}`
    );
  }
  const isParent = isWave || Boolean(hasChildren && waveBeatIds.length > 0);

  const id = generateId();
  const prompt =
    customPrompt ??
    (isParent
      ? [
          `You are executing a parent bead and its children. Implement the children beads and use the parent bead's notes/description for context and guidance. You MUST edit source files directly — do not just describe what to do.`,
          ``,
          `IMPORTANT INSTRUCTIONS:`,
          `1. Execute immediately in accept-edits mode; do not enter plan mode and do not wait for an execution follow-up prompt.`,
          `2. Use this parent bead's description/acceptance/notes as the source of truth for strategy and agent roles.`,
          `3. Use the Task tool to spawn subagents for independent child beads whenever parallel execution is possible.`,
          `4. Each subagent must work in a dedicated git worktree on an isolated short-lived branch.`,
          `5. Land final integrated changes on local main and push to origin/main. Do not require PRs unless explicitly requested.`,
          ``,
          `AUTONOMY: This is non-interactive Ship mode. If you call AskUserQuestion, the system may auto-answer using deterministic defaults. Prefer making reasonable assumptions and continue when possible.`,
          ``,
          `Parent ID: ${bead.id}`,
          `Parent Title: ${bead.title}`,
          `Type: ${bead.type}`,
          `Priority: P${bead.priority}`,
          waveBeatIds.length > 0
            ? `Open child bead IDs:\n${waveBeatIds.map((id) => `- ${id}`).join("\n")}`
            : "Open child bead IDs: (none loaded)",
          bead.description ? `\nDescription:\n${bead.description}` : "",
          bead.acceptance ? `\nAcceptance Criteria:\n${bead.acceptance}` : "",
          bead.notes ? `\nNotes:\n${bead.notes}` : "",
        ]
      : [
          `Implement the following task. You MUST edit the actual source files to make the change — do not just describe what to do.`,
          ``,
          `IMPORTANT INSTRUCTIONS:`,
          `1. Execute immediately in accept-edits mode; do not enter plan mode and do not wait for an execution follow-up prompt.`,
          `2. Use the Task tool to spawn subagents for independent subtasks whenever parallel execution is possible.`,
          `3. Each subagent must work in a dedicated git worktree on an isolated short-lived branch.`,
          `4. Land final integrated changes on local main and push to origin/main. Do not require PRs unless explicitly requested.`,
          ``,
          `AUTONOMY: This is non-interactive Ship mode. If you call AskUserQuestion, the system may auto-answer using deterministic defaults. Prefer making reasonable assumptions and continue when possible.`,
          ``,
          `ID: ${bead.id}`,
          `Title: ${bead.title}`,
          `Type: ${bead.type}`,
          `Priority: P${bead.priority}`,
          bead.description ? `\nDescription:\n${bead.description}` : "",
          bead.acceptance ? `\nAcceptance Criteria:\n${bead.acceptance}` : "",
          bead.notes ? `\nNotes:\n${bead.notes}` : "",
        ]
    )
      .filter(Boolean)
      .join("\n");

  const session: TerminalSession = {
    id,
    beadId: bead.id,
    beadTitle: bead.title,
    repoPath: repoPath || process.cwd(),
    status: "running",
    startedAt: new Date().toISOString(),
  };

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  const buffer: TerminalEvent[] = [];

  const interactionLog = await startInteractionLog({
    sessionId: id,
    interactionType: isParent ? "scene" : "take",
    repoPath: repoPath || process.cwd(),
    beadIds: isParent ? waveBeatIds : [beadId],
  }).catch((err) => {
    console.error(`[terminal-manager] Failed to start interaction log:`, err);
    return noopInteractionLog();
  });

  const entry: SessionEntry = { session, process: null, emitter, buffer, interactionLog };
  sessions.set(id, entry);

  const cwd = repoPath || process.cwd();

  console.log(`[terminal-manager] Creating session ${id}`);
  console.log(`[terminal-manager]   beadId: ${beadId}`);
  console.log(`[terminal-manager]   cwd: ${cwd}`);
  console.log(`[terminal-manager]   prompt: ${prompt.slice(0, 120)}...`);

  const agent = await getActionAgent("take");
  const dialect = resolveDialect(agent.command);
  const isInteractive = dialect === "claude";

  // For interactive (claude) sessions, use stream-json stdin; for codex, use one-shot prompt mode
  let agentCmd: string;
  let args: string[];
  if (isInteractive) {
    agentCmd = agent.command;
    args = [
      "-p",
      "--input-format", "stream-json",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
    ];
    if (agent.model) args.push("--model", agent.model);
  } else {
    const built = buildPromptModeArgs(agent, prompt);
    agentCmd = built.command;
    args = built.args;
  }
  const normalizeEvent = createLineNormalizer(dialect);

  const child = spawn(agentCmd, args, {
    cwd,
    env: { ...process.env },
    stdio: [isInteractive ? "pipe" : "ignore", "pipe", "pipe"],
  });
  entry.process = child;

  console.log(`[terminal-manager]   agent: ${agent.command}${agent.model ? ` (model: ${agent.model})` : ""}`);
  console.log(`[terminal-manager]   pid: ${child.pid ?? "failed to spawn"}`);

  const pushEvent = (evt: TerminalEvent) => {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(evt);
    emitter.emit("data", evt);
  };

  let stdinClosed = !isInteractive;
  let closeInputTimer: NodeJS.Timeout | null = null;
  const autoAnsweredToolUseIds = new Set<string>();
  const autoExecutionPrompt: string | null = null;
  const autoShipCompletionPrompt = !isInteractive
    ? null
    : customPrompt
      ? null
      : isParent
        ? buildWaveCompletionFollowUp(bead.id, waveBeatIds)
        : buildSingleBeadCompletionFollowUp(bead.id);
  let executionPromptSent = true;
  let shipCompletionPromptSent = false;

  const closeInput = () => {
    if (stdinClosed) return;
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;
    child.stdin?.end();
  };

  const cancelInputClose = () => {
    if (!closeInputTimer) return;
    clearTimeout(closeInputTimer);
    closeInputTimer = null;
  };

  const scheduleInputClose = () => {
    cancelInputClose();
    closeInputTimer = setTimeout(() => {
      closeInput();
    }, INPUT_CLOSE_GRACE_MS);
  };

  const sendUserTurn = (text: string): boolean => {
    if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded || stdinClosed) {
      return false;
    }
    cancelInputClose();
    const line = makeUserMessageLine(text);
    try {
      child.stdin.write(line);
      return true;
    } catch {
      return false;
    }
  };

  const maybeSendExecutionPrompt = (): boolean => {
    if (!autoExecutionPrompt || executionPromptSent) return false;
    const sent = sendUserTurn(autoExecutionPrompt);
    if (sent) {
      executionPromptSent = true;
      pushEvent({
        type: "stdout",
        data: "\x1b[33m-> Auto-sent execution follow-up prompt\x1b[0m\n",
        timestamp: Date.now(),
      });
      return true;
    }
    pushEvent({
      type: "stderr",
      data: "Failed to send execution follow-up prompt.\n",
      timestamp: Date.now(),
    });
    return false;
  };

  const maybeSendShipCompletionPrompt = (): boolean => {
    if (!autoShipCompletionPrompt || !executionPromptSent || shipCompletionPromptSent) return false;
    const sent = sendUserTurn(autoShipCompletionPrompt);
    if (sent) {
      shipCompletionPromptSent = true;
      pushEvent({
        type: "stdout",
        data: "\x1b[33m-> Auto-sent ship completion follow-up prompt\x1b[0m\n",
        timestamp: Date.now(),
      });
      return true;
    }
    pushEvent({
      type: "stderr",
      data: "Failed to send ship completion follow-up prompt.\n",
      timestamp: Date.now(),
    });
    return false;
  };

  const handleResultFollowUp = (): boolean => {
    if (maybeSendExecutionPrompt()) return true;
    if (maybeSendShipCompletionPrompt()) return true;
    return false;
  };

  const maybeAutoAnswerAskUser = (obj: JsonObject) => {
    if (obj.type !== "assistant") return;

    const msg = toObject(obj.message);
    const content = msg?.content;
    if (!Array.isArray(content)) return;

    for (const rawBlock of content) {
      const block = toObject(rawBlock);
      if (!block) continue;
      if (block.type !== "tool_use" || block.name !== "AskUserQuestion") continue;

      const toolUseId = typeof block.id === "string" ? block.id : null;
      if (!toolUseId || autoAnsweredToolUseIds.has(toolUseId)) continue;

      autoAnsweredToolUseIds.add(toolUseId);
      const autoResponse = buildAutoAskUserResponse(block.input);
      const sent = sendUserTurn(autoResponse);

      if (sent) {
        pushEvent({
          type: "stdout",
          data: `\x1b[33m-> Auto-answered AskUserQuestion (${toolUseId.slice(0, 12)}...)\x1b[0m\n`,
          timestamp: Date.now(),
        });
      } else {
        pushEvent({
          type: "stderr",
          data: "Failed to send auto-response for AskUserQuestion.\n",
          timestamp: Date.now(),
        });
      }
    }
  };

  // Parse stream-json NDJSON output from claude CLI
  let lineBuffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? ""; // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      interactionLog.logResponse(line);
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const obj = (normalizeEvent(raw) ?? raw) as Record<string, unknown>;
        maybeAutoAnswerAskUser(obj);

        if (obj.type === "result") {
          if (!handleResultFollowUp()) {
            scheduleInputClose();
          }
        } else {
          cancelInputClose();
        }

        const display = formatStreamEvent(obj);
        if (display) {
          console.log(`[terminal-manager] [${id}] display (${display.length} chars): ${display.slice(0, 150).replace(/\n/g, "\\n")}`);
          pushEvent({ type: "stdout", data: display, timestamp: Date.now() });
        }
      } catch {
        // Not valid JSON — pass through raw
        console.log(`[terminal-manager] [${id}] raw stdout: ${line.slice(0, 150)}`);
        pushEvent({ type: "stdout", data: line + "\n", timestamp: Date.now() });
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    console.log(`[terminal-manager] [${id}] stderr: ${text.slice(0, 200)}`);
    pushEvent({ type: "stderr", data: text, timestamp: Date.now() });
  });

  child.on("close", (code, signal) => {
    // Flush any remaining line buffer
    if (lineBuffer.trim()) {
      interactionLog.logResponse(lineBuffer);
      try {
        const obj = JSON.parse(lineBuffer) as Record<string, unknown>;
        maybeAutoAnswerAskUser(obj);

        if (obj.type === "result") {
          if (!handleResultFollowUp()) {
            scheduleInputClose();
          }
        } else {
          cancelInputClose();
        }

        const display = formatStreamEvent(obj);
        if (display) pushEvent({ type: "stdout", data: display, timestamp: Date.now() });
      } catch {
        pushEvent({ type: "stdout", data: lineBuffer + "\n", timestamp: Date.now() });
      }
      lineBuffer = "";
    }

    console.log(`[terminal-manager] [${id}] close: code=${code} signal=${signal} buffer=${buffer.length} events`);
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;
    session.exitCode = code ?? 1;
    session.status = code === 0 ? "completed" : "error";
    interactionLog.logEnd(code ?? 1, session.status);
    pushEvent({
      type: "exit",
      data: String(code ?? 1),
      timestamp: Date.now(),
    });
    // Release child process stream listeners to free closures
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;

    // Regroom ancestors after successful session completion
    if (code === 0) {
      regroomAncestors(beadId, cwd).catch((err) => {
        console.error(`[terminal-manager] regroom failed for ${beadId}:`, err);
      });

      // Trigger auto-verification workflow for code-producing actions
      const actionBeadIds = isParent ? waveBeatIds : [beadId];
      onAgentComplete(actionBeadIds, "take", cwd, code ?? 1).catch((err) => {
        console.error(`[terminal-manager] verification hook failed for ${beadId}:`, err);
      });
    }

    // Remove all emitter listeners after a short drain window so
    // SSE clients receive the final exit event before detachment.
    setTimeout(() => {
      emitter.removeAllListeners();
    }, 2000);

    setTimeout(() => {
      buffer.length = 0;
      sessions.delete(id);
    }, CLEANUP_DELAY_MS);
  });

  child.on("error", (err) => {
    console.error(`[terminal-manager] [${id}] spawn error:`, err.message);
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;
    session.status = "error";
    interactionLog.logEnd(1, "error");
    pushEvent({
      type: "stderr",
      data: `Process error: ${err.message}`,
      timestamp: Date.now(),
    });
    pushEvent({ type: "exit", data: "1", timestamp: Date.now() });
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;

    setTimeout(() => {
      emitter.removeAllListeners();
    }, 2000);

    setTimeout(() => {
      buffer.length = 0;
      sessions.delete(id);
    }, CLEANUP_DELAY_MS);
  });

  interactionLog.logPrompt(prompt);
  const initialPromptSent = sendUserTurn(prompt);
  if (!initialPromptSent) {
    closeInput();
    session.status = "error";
    interactionLog.logEnd(1, "error");
    child.kill("SIGTERM");
    sessions.delete(id);
    throw new Error("Failed to send initial prompt to claude");
  }

  return session;
}

export async function createSceneSession(
  beadIds: string[],
  repoPath?: string,
  customPrompt?: string
): Promise<TerminalSession> {
  // Enforce max concurrent sessions
  const running = Array.from(sessions.values()).filter(
    (e) => e.session.status === "running"
  );
  if (running.length >= MAX_SESSIONS) {
    throw new Error(`Max concurrent sessions (${MAX_SESSIONS}) reached`);
  }

  if (beadIds.length === 0) {
    throw new Error("At least one bead ID is required for a scene session");
  }

  // Fetch all bead details in parallel
  const beadResults = await Promise.all(
    beadIds.map((bid) => showBead(bid, repoPath))
  );
  const beads = beadResults.map((r, i) => {
    if (!r.ok || !r.data) {
      throw new Error(`Failed to fetch bead ${beadIds[i]}: ${r.error ?? "unknown error"}`);
    }
    return r.data;
  });

  const id = generateId();

  // Build combined prompt with all bead details
  const beadBlocks = beads
    .map(
      (bead, i) =>
        [
          `--- Bead ${i + 1} of ${beads.length} ---`,
          `ID: ${bead.id}`,
          `Title: ${bead.title}`,
          `Type: ${bead.type}`,
          `Priority: P${bead.priority}`,
          bead.description ? `\nDescription:\n${bead.description}` : "",
          bead.acceptance ? `\nAcceptance Criteria:\n${bead.acceptance}` : "",
          bead.notes ? `\nNotes:\n${bead.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n")
    )
    .join("\n\n");

  const prompt =
    customPrompt ??
    [
      `You are in SCENE MODE. You have ${beads.length} beads to implement.`,
      ``,
      `IMPORTANT INSTRUCTIONS:`,
      `1. Execute immediately in accept-edits mode; do not enter plan mode and do not wait for an execution follow-up prompt.`,
      `2. Use the bead descriptions/acceptance/notes below as your source of truth for sequencing and agent assignment.`,
      `3. Use the Task tool to spawn subagents for independent beads to maximize parallelism.`,
      `4. Each subagent must run in a dedicated git worktree on an isolated short-lived branch.`,
      `5. Land final integrated changes on local main and push to origin/main. Do not require PRs unless explicitly requested.`,
      `6. For each bead, once merge/push is confirmed, run exactly one verification command:`,
      ...beadIds.map((id) => buildVerificationStateCommand(id)),
      `7. In your final summary, report per bead: merged yes/no and verification command result.`,
      ``,
      `AUTONOMY: This is non-interactive Ship mode. If you call AskUserQuestion, the system may auto-answer using deterministic defaults. Prefer making reasonable assumptions and continue when possible.`,
      ``,
      beadBlocks,
    ].join("\n");

  const session: TerminalSession = {
    id,
    beadId: "scene",
    beadTitle: `Scene: ${beads.length} beads`,
    beadIds,
    repoPath: repoPath || process.cwd(),
    status: "running",
    startedAt: new Date().toISOString(),
  };

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  const buffer: TerminalEvent[] = [];

  const sceneInteractionLog = await startInteractionLog({
    sessionId: id,
    interactionType: "scene",
    repoPath: repoPath || process.cwd(),
    beadIds,
  }).catch((err) => {
    console.error(`[terminal-manager] Failed to start interaction log:`, err);
    return noopInteractionLog();
  });

  const entry: SessionEntry = { session, process: null, emitter, buffer, interactionLog: sceneInteractionLog };
  sessions.set(id, entry);

  const cwd = repoPath || process.cwd();

  console.log(`[terminal-manager] Creating scene session ${id}`);
  console.log(`[terminal-manager]   beadIds: ${beadIds.join(", ")}`);
  console.log(`[terminal-manager]   cwd: ${cwd}`);
  console.log(`[terminal-manager]   prompt: ${prompt.slice(0, 120)}...`);

  const agent = await getActionAgent("scene");
  const sceneDialect = resolveDialect(agent.command);
  const sceneIsInteractive = sceneDialect === "claude";

  let sceneAgentCmd: string;
  let args: string[];
  if (sceneIsInteractive) {
    sceneAgentCmd = agent.command;
    args = [
      "-p",
      "--input-format", "stream-json",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
    ];
    if (agent.model) args.push("--model", agent.model);
  } else {
    const built = buildPromptModeArgs(agent, prompt);
    sceneAgentCmd = built.command;
    args = built.args;
  }
  const sceneNormalizeEvent = createLineNormalizer(sceneDialect);

  const child = spawn(sceneAgentCmd, args, {
    cwd,
    env: { ...process.env },
    stdio: [sceneIsInteractive ? "pipe" : "ignore", "pipe", "pipe"],
  });
  entry.process = child;

  console.log(`[terminal-manager]   agent: ${agent.command}${agent.model ? ` (model: ${agent.model})` : ""}`);
  console.log(`[terminal-manager]   pid: ${child.pid ?? "failed to spawn"}`);

  const pushEvent = (evt: TerminalEvent) => {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(evt);
    emitter.emit("data", evt);
  };

  let stdinClosed = !sceneIsInteractive;
  let closeInputTimer: NodeJS.Timeout | null = null;
  const autoAnsweredToolUseIds = new Set<string>();
  const autoExecutionPrompt: string | null = null;
  // Scene prompts now include explicit verification-state commands, so a forced
  // second completion turn is unnecessary and can leave sessions hanging.
  const autoShipCompletionPrompt: string | null = null;
  let executionPromptSent = true;
  let shipCompletionPromptSent = false;

  const closeInput = () => {
    if (stdinClosed) return;
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;
    child.stdin?.end();
  };

  const cancelInputClose = () => {
    if (!closeInputTimer) return;
    clearTimeout(closeInputTimer);
    closeInputTimer = null;
  };

  const scheduleInputClose = () => {
    cancelInputClose();
    closeInputTimer = setTimeout(() => {
      closeInput();
    }, INPUT_CLOSE_GRACE_MS);
  };

  const sendUserTurn = (text: string): boolean => {
    if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded || stdinClosed) {
      return false;
    }
    cancelInputClose();
    const line = makeUserMessageLine(text);
    try {
      child.stdin.write(line);
      return true;
    } catch {
      return false;
    }
  };

  const maybeSendExecutionPrompt = (): boolean => {
    if (!autoExecutionPrompt || executionPromptSent) return false;
    const sent = sendUserTurn(autoExecutionPrompt);
    if (sent) {
      executionPromptSent = true;
      pushEvent({
        type: "stdout",
        data: "\x1b[33m-> Auto-sent execution follow-up prompt\x1b[0m\n",
        timestamp: Date.now(),
      });
      return true;
    }
    pushEvent({
      type: "stderr",
      data: "Failed to send execution follow-up prompt.\n",
      timestamp: Date.now(),
    });
    return false;
  };

  const maybeSendShipCompletionPrompt = (): boolean => {
    if (!autoShipCompletionPrompt || !executionPromptSent || shipCompletionPromptSent) return false;
    const sent = sendUserTurn(autoShipCompletionPrompt);
    if (sent) {
      shipCompletionPromptSent = true;
      pushEvent({
        type: "stdout",
        data: "\x1b[33m-> Auto-sent scene completion follow-up prompt\x1b[0m\n",
        timestamp: Date.now(),
      });
      return true;
    }
    pushEvent({
      type: "stderr",
      data: "Failed to send scene completion follow-up prompt.\n",
      timestamp: Date.now(),
    });
    return false;
  };

  const handleResultFollowUp = (): boolean => {
    if (maybeSendExecutionPrompt()) return true;
    if (maybeSendShipCompletionPrompt()) return true;
    return false;
  };

  const maybeAutoAnswerAskUser = (obj: JsonObject) => {
    if (obj.type !== "assistant") return;

    const msg = toObject(obj.message);
    const content = msg?.content;
    if (!Array.isArray(content)) return;

    for (const rawBlock of content) {
      const block = toObject(rawBlock);
      if (!block) continue;
      if (block.type !== "tool_use" || block.name !== "AskUserQuestion") continue;

      const toolUseId = typeof block.id === "string" ? block.id : null;
      if (!toolUseId || autoAnsweredToolUseIds.has(toolUseId)) continue;

      autoAnsweredToolUseIds.add(toolUseId);
      const autoResponse = buildAutoAskUserResponse(block.input);
      const sent = sendUserTurn(autoResponse);

      if (sent) {
        pushEvent({
          type: "stdout",
          data: `\x1b[33m-> Auto-answered AskUserQuestion (${toolUseId.slice(0, 12)}...)\x1b[0m\n`,
          timestamp: Date.now(),
        });
      } else {
        pushEvent({
          type: "stderr",
          data: "Failed to send auto-response for AskUserQuestion.\n",
          timestamp: Date.now(),
        });
      }
    }
  };

  // Parse stream-json NDJSON output from claude CLI
  let lineBuffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      sceneInteractionLog.logResponse(line);
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const obj = (sceneNormalizeEvent(raw) ?? raw) as Record<string, unknown>;
        maybeAutoAnswerAskUser(obj);

        if (obj.type === "result") {
          if (!handleResultFollowUp()) {
            scheduleInputClose();
          }
        } else {
          cancelInputClose();
        }

        const display = formatStreamEvent(obj);
        if (display) {
          console.log(`[terminal-manager] [${id}] display (${display.length} chars): ${display.slice(0, 150).replace(/\n/g, "\\n")}`);
          pushEvent({ type: "stdout", data: display, timestamp: Date.now() });
        }
      } catch {
        console.log(`[terminal-manager] [${id}] raw stdout: ${line.slice(0, 150)}`);
        pushEvent({ type: "stdout", data: line + "\n", timestamp: Date.now() });
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    console.log(`[terminal-manager] [${id}] stderr: ${text.slice(0, 200)}`);
    pushEvent({ type: "stderr", data: text, timestamp: Date.now() });
  });

  child.on("close", (code, signal) => {
    if (lineBuffer.trim()) {
      sceneInteractionLog.logResponse(lineBuffer);
      try {
        const obj = JSON.parse(lineBuffer) as Record<string, unknown>;
        maybeAutoAnswerAskUser(obj);

        if (obj.type === "result") {
          if (!handleResultFollowUp()) {
            scheduleInputClose();
          }
        } else {
          cancelInputClose();
        }

        const display = formatStreamEvent(obj);
        if (display) pushEvent({ type: "stdout", data: display, timestamp: Date.now() });
      } catch {
        pushEvent({ type: "stdout", data: lineBuffer + "\n", timestamp: Date.now() });
      }
      lineBuffer = "";
    }

    console.log(`[terminal-manager] [${id}] close: code=${code} signal=${signal} buffer=${buffer.length} events`);
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;
    session.exitCode = code ?? 1;
    session.status = code === 0 ? "completed" : "error";
    sceneInteractionLog.logEnd(code ?? 1, session.status);
    pushEvent({
      type: "exit",
      data: String(code ?? 1),
      timestamp: Date.now(),
    });
    // Release child process stream listeners to free closures
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;

    // Regroom ancestors for all beads in the scene
    if (code === 0) {
      Promise.all(
        beadIds.map((bid) => regroomAncestors(bid, cwd))
      ).catch((err) => {
        console.error(`[terminal-manager] regroom failed for scene:`, err);
      });

      // Trigger auto-verification workflow for scene beads
      onAgentComplete(beadIds, "scene", cwd, code ?? 1).catch((err) => {
        console.error(`[terminal-manager] verification hook failed for scene:`, err);
      });
    }

    // Remove all emitter listeners after a short drain window so
    // SSE clients receive the final exit event before detachment.
    setTimeout(() => {
      emitter.removeAllListeners();
    }, 2000);

    setTimeout(() => {
      buffer.length = 0;
      sessions.delete(id);
    }, CLEANUP_DELAY_MS);
  });

  child.on("error", (err) => {
    console.error(`[terminal-manager] [${id}] spawn error:`, err.message);
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;
    session.status = "error";
    sceneInteractionLog.logEnd(1, "error");
    pushEvent({
      type: "stderr",
      data: `Process error: ${err.message}`,
      timestamp: Date.now(),
    });
    pushEvent({ type: "exit", data: "1", timestamp: Date.now() });
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;

    setTimeout(() => {
      emitter.removeAllListeners();
    }, 2000);

    setTimeout(() => {
      buffer.length = 0;
      sessions.delete(id);
    }, CLEANUP_DELAY_MS);
  });

  sceneInteractionLog.logPrompt(prompt);
  const initialPromptSent = sendUserTurn(prompt);
  if (!initialPromptSent) {
    closeInput();
    session.status = "error";
    sceneInteractionLog.logEnd(1, "error");
    child.kill("SIGTERM");
    sessions.delete(id);
    throw new Error("Failed to send initial prompt to claude");
  }

  return session;
}

export function abortSession(id: string): boolean {
  const entry = sessions.get(id);
  if (!entry || !entry.process) return false;

  entry.session.status = "aborted";
  entry.process.kill("SIGTERM");

  setTimeout(() => {
    if (entry.process && !entry.process.killed) {
      entry.process.kill("SIGKILL");
    }
  }, 5000);

  return true;
}
