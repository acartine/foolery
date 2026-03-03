import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { getBackend } from "@/lib/backend-instance";
import {
  startInteractionLog,
  noopInteractionLog,
  type InteractionLog,
} from "@/lib/interaction-logger";
import { nextKnot } from "@/lib/knots";
import { regroomAncestors } from "@/lib/regroom";
import { getActionAgent, getStepAgent, loadSettings } from "@/lib/settings";
import {
  buildPromptModeArgs,
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import type { MemoryManagerType } from "@/lib/memory-managers";
import {
  buildWorkflowStateCommand,
  resolveMemoryManagerType,
} from "@/lib/memory-manager-commands";
import { validateCwd } from "@/lib/validate-cwd";
import type { TerminalSession, TerminalEvent } from "@/lib/types";
import { ORCHESTRATION_WAVE_LABEL } from "@/lib/wave-slugs";
import { onAgentComplete } from "@/lib/verification-orchestrator";
import { updateMessageTypeIndexFromSession } from "@/lib/agent-message-type-index";
import type { Beat, MemoryWorkflowDescriptor, RegisteredAgent } from "@/lib/types";
import {
  StepPhase,
  defaultWorkflowDescriptor,
  isQueueOrTerminal,
  isReviewStep,
  priorActionStep,
  resolveStep,
  workflowDescriptorById,
} from "@/lib/workflows";
import { recordStepAgent, resolvePoolAgent, getLastStepAgent } from "@/lib/agent-pool";

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
const MAX_TAKE_ITERATIONS = 10;
const QUEUE_TERMINAL_INVARIANT_INSTRUCTION = [
  `CRITICAL INVARIANT — QUEUE/TERMINAL STATE REQUIREMENT:`,
  `Before ending your work, you MUST ensure the knot is in a queue state (ready_for_*) or terminal state (shipped/abandoned).`,
  `Never leave work in an action state (planning, plan_review, implementation, implementation_review, shipment, shipment_review).`,
  `If the knot is currently in an action state, run "kno next <id> --expected-state <currentState> --actor-kind agent" to advance it to the next queue state before stopping.`,
].join("\n");

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

interface WorkflowPromptTarget {
  id: string;
  workflow: MemoryWorkflowDescriptor;
  workflowState?: string;
}

function normalizeWorkflowState(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function buildGranularProgressionCommands(
  target: WorkflowPromptTarget,
  memoryManagerType: MemoryManagerType,
): string[] {
  const nonTerminalStates = target.workflow.states.filter(
    (state) => !target.workflow.terminalStates.includes(state),
  );
  if (nonTerminalStates.length === 0) return [];

  const current = normalizeWorkflowState(target.workflowState);
  const currentIndex = current ? nonTerminalStates.indexOf(current) : -1;
  const progression =
    currentIndex >= 0 && currentIndex + 1 < nonTerminalStates.length
      ? nonTerminalStates.slice(currentIndex + 1)
      : nonTerminalStates;

  const commands = progression.map((state) =>
    buildWorkflowStateCommand(target.id, state, memoryManagerType),
  );
  return [...new Set(commands)];
}

function buildSingleTargetFollowUpLines(
  target: WorkflowPromptTarget,
  memoryManagerType: MemoryManagerType,
): string[] {
  const lines: string[] = [
    `Beat ${target.id} (${target.workflow.mode}):`,
  ];

  if (target.workflow.mode === "granular_autonomous") {
    const commands = buildGranularProgressionCommands(target, memoryManagerType);
    lines.push("Progress through workflow states in order after merge/push:");
    if (commands.length > 0) {
      lines.push(...commands.map((command) => `- ${command}`));
    } else {
      lines.push("- No non-terminal progression states configured.");
    }
    return lines;
  }

  lines.push("Human review is required: either review manually or delegate review to an agent.");
  if (target.workflow.finalCutState) {
    lines.push("After merge/PR handling, move bead to the next human-action queue:");
    lines.push(`- ${buildWorkflowStateCommand(target.id, target.workflow.finalCutState, memoryManagerType)}`);
  } else {
    lines.push("This workflow does not define a human-action queue state.");
  }
  return lines;
}

function buildSingleBeadCompletionFollowUp(
  target: WorkflowPromptTarget,
  memoryManagerType: MemoryManagerType,
): string {
  return [
    "Ship completion follow-up:",
    `Confirm that changes for ${target.id} are merged and pushed according to your normal shipping guidelines.`,
    "Do not ask for another follow-up prompt until merge/push confirmation is done (or blocked by a hard error).",
    ...buildSingleTargetFollowUpLines(target, memoryManagerType),
    "Then summarize merge/push confirmation and workflow command results.",
  ].join("\n");
}

function buildWaveCompletionFollowUp(
  waveId: string,
  targets: WorkflowPromptTarget[],
  memoryManagerType: MemoryManagerType,
): string {
  const safeTargets = targets.length > 0
    ? targets
    : [{ id: waveId, workflow: defaultWorkflowDescriptor() }];
  return [
    "Scene completion follow-up:",
    `Handle this in one pass for scene ${waveId}.`,
    "For EACH bead below, confirm merge/push status before workflow transitions.",
    "Do not ask for another follow-up prompt until all listed beats are merge-confirmed (or blocked by a hard error).",
    ...safeTargets.flatMap((target) => buildSingleTargetFollowUpLines(
      target,
      memoryManagerType,
    )),
    "Then summarize per bead: merged yes/no, pushed yes/no, workflow command results, and PR/review notes when applicable.",
  ].join("\n");
}

function assertKnotsClaimable(beats: Beat[], action: string): void {
  const blocked = beats.filter((beat) => beat.isAgentClaimable === false);
  if (blocked.length === 0) return;
  const summary = blocked
    .map((beat) => `${beat.id}${beat.state ? ` (${beat.state})` : ""}`)
    .join(", ");
  throw new Error(`${action} unavailable: knot is not agent-claimable (${summary})`);
}

function resolveWorkflowForBeat(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
  fallbackWorkflow: MemoryWorkflowDescriptor,
): MemoryWorkflowDescriptor {
  if (beat.workflowId) {
    const matched = workflowsById.get(beat.workflowId);
    if (matched) return matched;
  }
  return fallbackWorkflow;
}

function toWorkflowPromptTarget(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
  fallbackWorkflow: MemoryWorkflowDescriptor,
): WorkflowPromptTarget {
  return {
    id: beat.id,
    workflow: resolveWorkflowForBeat(beat, workflowsById, fallbackWorkflow),
    workflowState: beat.state,
  };
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

function isTerminalBeatState(state: string | undefined): boolean {
  if (!state) return false;
  return state === "closed" || state === "shipped" || state === "abandoned";
}

function isAgentOwnedActionState(
  beat: Beat,
  workflow: MemoryWorkflowDescriptor,
): boolean {
  const resolved = resolveStep(beat.state);
  if (!resolved || resolved.phase !== StepPhase.Active) return false;
  const ownerKind = workflow.owners?.[resolved.step] ?? beat.nextActionOwnerKind ?? "agent";
  return ownerKind === "agent";
}

function isExpectedStateMismatchError(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes("expected state") && normalized.includes("currently");
}

type GuardedNextKnotResult =
  | { ok: true }
  | { ok: false; error: string; expectedStateMismatch: boolean };

async function nextKnotGuarded(
  knotId: string,
  expectedState: string,
  repoPath: string | undefined,
): Promise<GuardedNextKnotResult> {
  const result = await nextKnot(knotId, repoPath, {
    actorKind: "agent",
    expectedState,
  });
  if (result.ok) return { ok: true };
  const error = typeof result.error === "string" ? result.error : "unknown";
  return {
    ok: false,
    error,
    expectedStateMismatch: isExpectedStateMismatchError(error),
  };
}

async function advanceAgentOwnedActionStateToQueue(
  beat: Beat,
  repoPath: string | undefined,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
  fallbackWorkflow: MemoryWorkflowDescriptor,
  contextLabel: string,
): Promise<Beat> {
  const workflow = resolveWorkflowForBeat(beat, workflowsById, fallbackWorkflow);
  if (!isAgentOwnedActionState(beat, workflow)) return beat;

  const tag = `[terminal-manager] [${contextLabel}] [action-heal]`;
  console.log(`${tag} advancing ${beat.id} from action state=${beat.state}`);

  const nextResult = await nextKnotGuarded(beat.id, beat.state, repoPath);
  if (!nextResult.ok && !nextResult.expectedStateMismatch) {
    console.warn(`${tag} failed to advance ${beat.id}: ${nextResult.error}`);
    return beat;
  }
  if (!nextResult.ok) {
    console.log(
      `${tag} skipped stale advance for ${beat.id}: ${nextResult.error}`,
    );
  }

  const refreshed = await getBackend().get(beat.id, repoPath);
  if (!refreshed.ok || !refreshed.data) {
    console.warn(`${tag} failed to reload ${beat.id} after advance`);
    return beat;
  }

  console.log(
    `${tag} advanced ${beat.id}: ${beat.state} -> ${refreshed.data.state} claimable=${refreshed.data.isAgentClaimable}`,
  );
  return refreshed.data;
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
    const isError = Boolean(obj.is_error);
    const cost = obj.cost_usd as number | undefined;
    const dur = obj.duration_ms as number | undefined;
    const parts: string[] = [];
    if (result) {
      parts.push(isError ? `\x1b[31m${result}\x1b[0m` : result);
    }
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
  beatId: string,
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
  const result = await getBackend().get(beatId, repoPath);
  if (!result.ok || !result.data) {
    throw new Error(result.error?.message ?? "Failed to fetch beat");
  }
  let bead = result.data;
  const workflowsResult = await getBackend().listWorkflows(repoPath);
  const workflows = workflowsResult.ok ? workflowsResult.data ?? [] : [];
  const workflowsById = workflowDescriptorById(workflows);
  const fallbackWorkflow = workflows[0] ?? defaultWorkflowDescriptor();
  const isWave = bead.labels?.includes(ORCHESTRATION_WAVE_LABEL) ?? false;
  // Check for children — both orchestrated waves and plain parent beads
  let waveBeatIds: string[] = [];
  let waveBeats: Beat[] = [];
  const childResult = await getBackend().list({ parent: bead.id }, repoPath);
  const hasChildren = childResult.ok && childResult.data && childResult.data.length > 0;
  if (hasChildren) {
    waveBeats = childResult.data!
      .filter((child) => !isTerminalBeatState(child.state))
      .sort((a, b) => a.id.localeCompare(b.id));
    waveBeatIds = waveBeats.map((child) => child.id);
  } else if (isWave) {
    console.warn(
      `[terminal-manager] Failed to load scene children for ${bead.id}: ${childResult.error?.message ?? "no children found"}`
    );
  }
  const isParent = isWave || Boolean(hasChildren && waveBeatIds.length > 0);
  const resolvedRepoPath = repoPath || process.cwd();
  const memoryManagerType = resolveMemoryManagerType(resolvedRepoPath);
  if (memoryManagerType === "knots") {
    const targets = isParent ? waveBeats : [bead];
    const healedTargets = await Promise.all(
      targets.map((target) =>
        advanceAgentOwnedActionStateToQueue(
          target,
          repoPath,
          workflowsById,
          fallbackWorkflow,
          beatId,
        )
      ),
    );
    if (isParent) {
      waveBeats = healedTargets.filter((child) => !isTerminalBeatState(child.state));
      waveBeatIds = waveBeats.map((child) => child.id);
      assertKnotsClaimable(waveBeats, "Scene");
    } else {
      bead = healedTargets[0] ?? bead;
      assertKnotsClaimable([bead], "Take");
    }
  }
  const primaryTarget = toWorkflowPromptTarget(bead, workflowsById, fallbackWorkflow);
  const sceneTargets = waveBeats.map((child) =>
    toWorkflowPromptTarget(child, workflowsById, fallbackWorkflow),
  );

  // Resolve agent: try pool selection by workflow step, fall back to action mapping
  const resolved = resolveStep(bead.state);
  const agent = resolved
    ? await getStepAgent(resolved.step, "take", beatId)
    : await getActionAgent("take");

  // Record initial agent selection for cross-agent review tracking
  if (resolved && agent.agentId) {
    recordStepAgent(beatId, resolved.step, agent.agentId);
  }

  const id = generateId();
  let prompt: string;
  if (customPrompt) {
    prompt = customPrompt;
  } else {
    // Ask the backend for the task-specific prompt
    const takePromptResult = await getBackend().buildTakePrompt(
      bead.id,
      {
        isParent,
        childBeatIds: waveBeatIds.length > 0 ? waveBeatIds : undefined,
      },
      repoPath,
    );
    if (!takePromptResult.ok || !takePromptResult.data) {
      throw new Error(takePromptResult.error?.message ?? "Failed to build take prompt");
    }
    const taskPrompt = takePromptResult.data.prompt;

    // Wrap backend prompt with Foolery execution instructions
    prompt = (isParent
      ? [
          `You are executing a parent bead and its children. Implement the children beads and use the parent bead's notes/description for context and guidance. You MUST edit source files directly — do not just describe what to do.`,
          ``,
          QUEUE_TERMINAL_INVARIANT_INSTRUCTION,
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
          taskPrompt,
        ]
      : [
          `Implement the following task. You MUST edit the actual source files to make the change — do not just describe what to do.`,
          ``,
          QUEUE_TERMINAL_INVARIANT_INSTRUCTION,
          ``,
          `IMPORTANT INSTRUCTIONS:`,
          `1. Execute immediately in accept-edits mode; do not enter plan mode and do not wait for an execution follow-up prompt.`,
          `2. Use the Task tool to spawn subagents for independent subtasks whenever parallel execution is possible.`,
          `3. Each subagent must work in a dedicated git worktree on an isolated short-lived branch.`,
          `4. Land final integrated changes on local main and push to origin/main. Do not require PRs unless explicitly requested.`,
          ``,
          `AUTONOMY: This is non-interactive Ship mode. If you call AskUserQuestion, the system may auto-answer using deterministic defaults. Prefer making reasonable assumptions and continue when possible.`,
          ``,
          taskPrompt,
        ]
    ).filter(Boolean).join("\n");
  }

  const session: TerminalSession = {
    id,
    beatId: bead.id,
    beatTitle: bead.title,
    repoPath: resolvedRepoPath,
    agentName: agent.label || agent.command,
    agentModel: agent.model,
    agentVersion: agent.version,
    agentCommand: agent.command,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  const buffer: TerminalEvent[] = [];

  const interactionLog = await startInteractionLog({
    sessionId: id,
    interactionType: isParent ? "scene" : "take",
    repoPath: resolvedRepoPath,
    beatIds: isParent ? waveBeatIds : [beatId],
    agentName: agent.label || agent.command,
    agentModel: agent.model,
  }).catch((err) => {
    console.error(`[terminal-manager] Failed to start interaction log:`, err);
    return noopInteractionLog();
  });

  const entry: SessionEntry = { session, process: null, emitter, buffer, interactionLog };
  sessions.set(id, entry);

  const cwd = resolvedRepoPath;

  const pushEvent = (evt: TerminalEvent) => {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(evt);
    emitter.emit("data", evt);
  };

  // Validate CWD exists before spawning — emit structured error on failure
  // so classifyTerminalFailure detects it as a missing_cwd failure.
  const cwdError = await validateCwd(cwd);
  if (cwdError) {
    console.error(`[terminal-manager] CWD validation failed for session ${id}: ${cwd}`);
    session.status = "error";
    interactionLog.logEnd(1, "error");
    pushEvent({ type: "stderr", data: `${cwdError}\n`, timestamp: Date.now() });
    pushEvent({ type: "exit", data: "1", timestamp: Date.now() });
    setTimeout(() => { emitter.removeAllListeners(); }, 2000);
    setTimeout(() => { buffer.length = 0; sessions.delete(id); }, CLEANUP_DELAY_MS);
    return session;
  }

  console.log(`[terminal-manager] Creating session ${id}`);
  console.log(`[terminal-manager]   beatId: ${beatId}`);
  console.log(`[terminal-manager]   cwd: ${cwd}`);
  console.log(`[terminal-manager]   prompt: ${prompt.slice(0, 120)}...`);

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

  // ── Take loop infrastructure (knots single-beat only) ─────────
  const isTakeLoop = memoryManagerType === "knots" && !isParent && !customPrompt;
  let takeIteration = 1;

  const wrapSingleBeatPrompt = (taskPrompt: string): string => {
    return [
      `Implement the following task. You MUST edit the actual source files to make the change — do not just describe what to do.`,
      ``,
      QUEUE_TERMINAL_INVARIANT_INSTRUCTION,
      ``,
      `IMPORTANT INSTRUCTIONS:`,
      `1. Execute immediately in accept-edits mode; do not enter plan mode and do not wait for an execution follow-up prompt.`,
      `2. Use the Task tool to spawn subagents for independent subtasks whenever parallel execution is possible.`,
      `3. Each subagent must work in a dedicated git worktree on an isolated short-lived branch.`,
      `4. Land final integrated changes on local main and push to origin/main. Do not require PRs unless explicitly requested.`,
      ``,
      `AUTONOMY: This is non-interactive Ship mode. If you call AskUserQuestion, the system may auto-answer using deterministic defaults. Prefer making reasonable assumptions and continue when possible.`,
      ``,
      taskPrompt,
    ].filter(Boolean).join("\n");
  };

  const buildNextTakePrompt = async (): Promise<{ prompt: string; beatState: string; agentOverride?: RegisteredAgent } | null> => {
    const tag = `[terminal-manager] [${id}] [take-loop]`;

    // Fetch the beat's current state to decide whether to continue.
    const currentResult = await getBackend().get(beatId, repoPath);
    if (!currentResult.ok || !currentResult.data) {
      console.log(`${tag} get(${beatId}) failed: ok=${currentResult.ok} error=${currentResult.error?.message ?? "no data"}`);
      pushEvent({
        type: "stderr",
        data: `Take loop: failed to fetch ${beatId}: ${currentResult.error?.message ?? "no data"}\n`,
        timestamp: Date.now(),
      });
      return null;
    }

    let current = currentResult.data;
    let workflow = resolveWorkflowForBeat(current, workflowsById, fallbackWorkflow);

    console.log(
      `${tag} beat=${beatId} state=${current.state} isAgentClaimable=${current.isAgentClaimable}` +
      ` profileId=${current.profileId} workflowId=${current.workflowId}` +
      ` nextActionOwnerKind=${current.nextActionOwnerKind} requiresHumanAction=${current.requiresHumanAction}` +
      ` terminalStates=[${workflow.terminalStates}] iteration=${takeIteration}`,
    );

    if (workflow.terminalStates.includes(current.state)) {
      console.log(`${tag} STOP: terminal state "${current.state}"`);
      pushEvent({
        type: "stdout",
        data: `\x1b[33m--- Take loop stopped: reached terminal state "${current.state}" after ${takeIteration} iteration(s) ---\x1b[0m\n`,
        timestamp: Date.now(),
      });
      return null;
    }

    let resolved = resolveStep(current.state);
    let stepOwner = resolved ? workflow.owners?.[resolved.step] ?? "agent" : "none";
    if (resolved?.phase === StepPhase.Active && stepOwner === "agent") {
      console.log(`${tag} auto-advancing ${beatId} from active state=${current.state}`);
      const nextResult = await nextKnotGuarded(beatId, current.state, repoPath);
      if (!nextResult.ok && !nextResult.expectedStateMismatch) {
        console.log(`${tag} STOP: auto-advance failed for ${beatId}: ${nextResult.error}`);
        pushEvent({
          type: "stderr",
          data: `Take loop: failed to advance ${beatId} from ${current.state}: ${nextResult.error}\n`,
          timestamp: Date.now(),
        });
        return null;
      }
      if (!nextResult.ok) {
        console.log(
          `${tag} auto-advance skipped for ${beatId} due stale expected state: ${nextResult.error}`,
        );
      }

      const refreshedResult = await getBackend().get(beatId, repoPath);
      if (!refreshedResult.ok || !refreshedResult.data) {
        console.log(`${tag} STOP: failed to reload ${beatId} after auto-advance`);
        pushEvent({
          type: "stderr",
          data: `Take loop: failed to reload ${beatId} after auto-advance\n`,
          timestamp: Date.now(),
        });
        return null;
      }

      current = refreshedResult.data;
      workflow = resolveWorkflowForBeat(current, workflowsById, fallbackWorkflow);
      resolved = resolveStep(current.state);
      stepOwner = resolved ? workflow.owners?.[resolved.step] ?? "agent" : "none";
      console.log(
        `${tag} auto-advance result: beat=${beatId} state=${current.state}` +
        ` isAgentClaimable=${current.isAgentClaimable}`,
      );
    }
    if (!resolved || stepOwner !== "agent") {
      console.log(
        `${tag} STOP: not agent-owned — state=${current.state}` +
        ` step=${resolved?.step ?? "none"} phase=${resolved?.phase ?? "none"}` +
        ` stepOwner=${stepOwner}`,
      );
      pushEvent({
        type: "stdout",
        data: `\x1b[33m--- Take loop stopped: state "${current.state}" is not agent-owned (step=${resolved?.step ?? "none"}, owner=${stepOwner}) after ${takeIteration} iteration(s) ---\x1b[0m\n`,
        timestamp: Date.now(),
      });
      return null;
    }

    // Cross-agent review: select a different agent from the pool for review
    // steps instead of reusing the action agent. Falls back to the session
    // agent when no alternative is available (or pools not configured).
    let reviewAgentOverride: RegisteredAgent | undefined;
    if (isReviewStep(resolved.step)) {
      try {
        const settings = await loadSettings();
        if (settings.dispatchMode === "pools") {
          const actionStep = priorActionStep(resolved.step);
          const excludeId = agent.agentId
            ?? (actionStep ? getLastStepAgent(beatId, actionStep) : undefined);

          const poolAgent = resolvePoolAgent(
            resolved.step,
            settings.pools,
            settings.agents,
            excludeId,
          );

          if (poolAgent) {
            reviewAgentOverride = poolAgent;
            if (poolAgent.agentId) {
              recordStepAgent(beatId, resolved.step, poolAgent.agentId);
            }
            console.log(
              `${tag} cross-agent review: step="${resolved.step}" ` +
              `selected="${poolAgent.agentId ?? poolAgent.command}" ` +
              `(excluded: ${excludeId ?? "none"})`,
            );
          }
        }
      } catch {
        // Settings load failure should not block the take loop
      }
    }

    // Claim the same beat into its next workflow state.
    console.log(`${tag} claiming ${beatId} from state=${current.state}`);
    const takeResult = await getBackend().buildTakePrompt(
      beatId,
      {},
      repoPath,
    );
    if (!takeResult.ok || !takeResult.data) {
      console.log(`${tag} STOP: buildTakePrompt failed — ok=${takeResult.ok} error=${takeResult.error?.message ?? "no data"}`);
      pushEvent({
        type: "stderr",
        data: `Take loop: failed to claim ${beatId}: ${takeResult.error?.message ?? "unknown error"}\n`,
        timestamp: Date.now(),
      });
      return null;
    }

    console.log(`${tag} CONTINUE: claimed ${beatId} → iteration ${takeIteration + 1}`);
    pushEvent({
      type: "stdout",
      data: `\x1b[36m--- Claimed ${beatId} (iteration ${takeIteration + 1}) ---\x1b[0m\n`,
      timestamp: Date.now(),
    });

    return { prompt: wrapSingleBeatPrompt(takeResult.data.prompt), beatState: current.state, agentOverride: reviewAgentOverride };
  };

  /**
   * Enforce queue/terminal invariant after a take-loop iteration.
   * Returns true if the beat is already in a valid resting state.
   * If the beat is in an action state after retry exhaustion, forces rollback.
   */
  const enforceQueueTerminalInvariant = async (): Promise<boolean> => {
    const tag = `[terminal-manager] [${id}] [invariant]`;
    const currentResult = await getBackend().get(beatId, repoPath);
    if (!currentResult.ok || !currentResult.data) {
      console.log(`${tag} failed to fetch beat state for invariant check`);
      return true; // cannot verify — treat as ok to avoid blocking
    }

    const current = currentResult.data;
    const workflow = resolveWorkflowForBeat(current, workflowsById, fallbackWorkflow);

    if (isQueueOrTerminal(current.state, workflow)) {
      console.log(`${tag} beat=${beatId} state=${current.state} — invariant satisfied`);
      return true;
    }

    console.warn(`${tag} [WARN] beat=${beatId} state=${current.state} — VIOLATION: action state on exit`);
    pushEvent({
      type: "stdout",
      data: `\x1b[33m--- Invariant violation: beat ${beatId} in action state "${current.state}" after agent exit ---\x1b[0m\n`,
      timestamp: Date.now(),
    });

    // Layer 3: advance to the next queue/terminal state via kno next
    console.warn(`${tag} [WARN] advancing via nextKnot from action state: ${current.state}`);
    const nextResult = await nextKnotGuarded(beatId, current.state, repoPath);
    if (nextResult.ok) {
      pushEvent({
        type: "stdout",
        data: `\x1b[33m--- Invariant fix: advanced ${beatId} from action state "${current.state}" via kno next ---\x1b[0m\n`,
        timestamp: Date.now(),
      });
      console.warn(`${tag} [WARN] nextKnot succeeded for ${beatId}`);
    } else if (nextResult.expectedStateMismatch) {
      console.warn(`${tag} [WARN] nextKnot skipped due stale expected state: ${nextResult.error}`);
      const refreshed = await getBackend().get(beatId, repoPath);
      if (refreshed.ok && refreshed.data) {
        const refreshedWorkflow = resolveWorkflowForBeat(refreshed.data, workflowsById, fallbackWorkflow);
        if (isQueueOrTerminal(refreshed.data.state, refreshedWorkflow)) {
          console.log(`${tag} beat=${beatId} state=${refreshed.data.state} — invariant satisfied after stale check`);
          return true;
        }
      }
    } else {
      console.error(`${tag} nextKnot failed: ${nextResult.error}`);
      pushEvent({
        type: "stderr",
        data: `Invariant enforcement: failed to advance ${beatId} from ${current.state}: ${nextResult.error}\n`,
        timestamp: Date.now(),
      });
    }
    return false;
  };

  let sessionFinished = false;
  const finishSession = (exitCode: number) => {
    if (sessionFinished) return;
    sessionFinished = true;
    session.exitCode = exitCode;
    session.status = exitCode === 0 ? "completed" : "error";
    interactionLog.logEnd(exitCode, session.status);
    pushEvent({ type: "exit", data: String(exitCode), timestamp: Date.now() });
    entry.process = null;

    if (exitCode === 0) {
      regroomAncestors(beatId, cwd).catch((err) => {
        console.error(`[terminal-manager] regroom failed for ${beatId}:`, err);
      });
      const actionBeatIds = isParent ? waveBeatIds : [beatId];
      onAgentComplete(actionBeatIds, "take", cwd, exitCode).catch((err) => {
        console.error(`[terminal-manager] verification hook failed for ${beatId}:`, err);
      });
      const logFile = interactionLog.filePath;
      if (logFile) {
        updateMessageTypeIndexFromSession(
          logFile,
          agent.label || agent.command,
          agent.model,
        ).catch((err) => {
          console.error(`[terminal-manager] message type index update failed:`, err);
        });
      }
    }

    setTimeout(() => { emitter.removeAllListeners(); }, 2000);
    setTimeout(() => { buffer.length = 0; sessions.delete(id); }, CLEANUP_DELAY_MS);
  };

  /** Spawn a fresh agent child process for a take-loop iteration. */
  const spawnTakeChild = (takePrompt: string, beatState?: string, agentOverride?: RegisteredAgent): void => {
    // Resolve effective agent for this iteration
    const effectiveAgent = agentOverride ?? agent;
    const effectiveDialect = resolveDialect(effectiveAgent.command);
    const effectiveIsInteractive = effectiveDialect === "claude";

    let effectiveCmd: string;
    let effectiveArgs: string[];
    if (effectiveIsInteractive) {
      effectiveCmd = effectiveAgent.command;
      effectiveArgs = [
        "-p",
        "--input-format", "stream-json",
        "--verbose",
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
      ];
      if (effectiveAgent.model) effectiveArgs.push("--model", effectiveAgent.model);
    } else {
      const built = buildPromptModeArgs(effectiveAgent, takePrompt);
      effectiveCmd = built.command;
      effectiveArgs = built.args;
    }
    const effectiveNormalizeEvent = createLineNormalizer(effectiveDialect);

    const takeChild = spawn(effectiveCmd, effectiveArgs, {
      cwd,
      env: { ...process.env },
      stdio: [effectiveIsInteractive ? "pipe" : "ignore", "pipe", "pipe"],
    });
    entry.process = takeChild;

    console.log(`[terminal-manager] [${id}] [take-loop] iteration ${takeIteration}: pid=${takeChild.pid ?? "failed"} beat=${beatId} beat_state=${beatState ?? "unknown"}`);

    let takeStdinClosed = !effectiveIsInteractive;
    let takeLineBuffer = "";
    let takeCloseInputTimer: NodeJS.Timeout | null = null;
    const takeAutoAnsweredIds = new Set<string>();

    const takeCloseInput = () => {
      if (takeStdinClosed) return;
      if (takeCloseInputTimer) { clearTimeout(takeCloseInputTimer); takeCloseInputTimer = null; }
      takeStdinClosed = true;
      takeChild.stdin?.end();
    };

    const takeCancelInputClose = () => {
      if (!takeCloseInputTimer) return;
      clearTimeout(takeCloseInputTimer);
      takeCloseInputTimer = null;
    };

    const takeScheduleInputClose = () => {
      takeCancelInputClose();
      takeCloseInputTimer = setTimeout(() => takeCloseInput(), INPUT_CLOSE_GRACE_MS);
    };

    const takeSendUserTurn = (text: string, source = "manual"): boolean => {
      if (!takeChild.stdin || takeChild.stdin.destroyed || takeChild.stdin.writableEnded || takeStdinClosed) {
        return false;
      }
      takeCancelInputClose();
      const line = makeUserMessageLine(text);
      try {
        takeChild.stdin.write(line);
        interactionLog.logPrompt(text, { source });
        return true;
      } catch {
        return false;
      }
    };

    const takeAutoAnswerAskUser = (obj: JsonObject) => {
      if (obj.type !== "assistant") return;
      const msg = toObject(obj.message);
      const content = msg?.content;
      if (!Array.isArray(content)) return;
      for (const rawBlock of content) {
        const block = toObject(rawBlock);
        if (!block) continue;
        if (block.type !== "tool_use" || block.name !== "AskUserQuestion") continue;
        const toolUseId = typeof block.id === "string" ? block.id : null;
        if (!toolUseId || takeAutoAnsweredIds.has(toolUseId)) continue;
        takeAutoAnsweredIds.add(toolUseId);
        const autoResponse = buildAutoAskUserResponse(block.input);
        const sent = takeSendUserTurn(autoResponse, "auto_ask_user_response");
        if (sent) {
          pushEvent({
            type: "stdout",
            data: `\x1b[33m-> Auto-answered AskUserQuestion (${toolUseId.slice(0, 12)}...)\x1b[0m\n`,
            timestamp: Date.now(),
          });
        }
      }
    };

    takeChild.stdout?.on("data", (chunk: Buffer) => {
      interactionLog.logStdout(chunk.toString());
      takeLineBuffer += chunk.toString();
      const lines = takeLineBuffer.split("\n");
      takeLineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        interactionLog.logResponse(line);
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          const obj = (effectiveNormalizeEvent(raw) ?? raw) as Record<string, unknown>;
          takeAutoAnswerAskUser(obj);
          if (obj.type === "result") {
            takeScheduleInputClose();
          } else {
            takeCancelInputClose();
          }
          const display = formatStreamEvent(obj);
          if (display) {
            pushEvent({ type: "stdout", data: display, timestamp: Date.now() });
          }
        } catch {
          pushEvent({ type: "stdout", data: line + "\n", timestamp: Date.now() });
        }
      }
    });

    takeChild.stderr?.on("data", (chunk: Buffer) => {
      interactionLog.logStderr(chunk.toString());
      pushEvent({ type: "stderr", data: chunk.toString(), timestamp: Date.now() });
    });

    takeChild.on("close", (takeCode) => {
      if (takeLineBuffer.trim()) {
        interactionLog.logResponse(takeLineBuffer);
        try {
          const obj = JSON.parse(takeLineBuffer) as Record<string, unknown>;
          takeAutoAnswerAskUser(obj);
          if (obj.type === "result") takeScheduleInputClose();
          const display = formatStreamEvent(obj);
          if (display) pushEvent({ type: "stdout", data: display, timestamp: Date.now() });
        } catch {
          pushEvent({ type: "stdout", data: takeLineBuffer + "\n", timestamp: Date.now() });
        }
        takeLineBuffer = "";
      }

      if (takeCloseInputTimer) { clearTimeout(takeCloseInputTimer); takeCloseInputTimer = null; }
      takeStdinClosed = true;
      takeChild.stdout?.removeAllListeners();
      takeChild.stderr?.removeAllListeners();
      entry.process = null;

      const tag = `[terminal-manager] [${id}] [take-loop]`;
      console.log(`${tag} child close: code=${takeCode} iteration=${takeIteration}/${MAX_TAKE_ITERATIONS} beat=${beatId}`);

      getBackend().get(beatId, repoPath).then((r) => {
        const state = r.ok && r.data ? r.data.state : "unknown";
        const claimable = r.ok && r.data ? r.data.isAgentClaimable : "unknown";
        console.log(`${tag} post-close beat state: beat=${beatId} state=${state} isAgentClaimable=${claimable}`);
        interactionLog.logBeatState({
          beatId,
          state,
          phase: "after_prompt",
          iteration: takeIteration,
        });
      }).catch(() => {
        console.log(`${tag} post-close beat fetch failed: beat=${beatId}`);
      });

      if (takeCode !== 0) {
        console.log(`${tag} STOP: non-zero exit code=${takeCode}`);
        enforceQueueTerminalInvariant().finally(() => {
          finishSession(takeCode ?? 1);
        });
        return;
      }

      if (takeIteration >= MAX_TAKE_ITERATIONS) {
        console.log(`${tag} STOP: max iterations reached (${takeIteration}/${MAX_TAKE_ITERATIONS})`);
        pushEvent({
          type: "stdout",
          data: `\x1b[33m--- Take loop stopped: max ${MAX_TAKE_ITERATIONS} iterations reached ---\x1b[0m\n`,
          timestamp: Date.now(),
        });
        enforceQueueTerminalInvariant().finally(() => {
          finishSession(takeCode ?? 1);
        });
        return;
      }

      console.log(`${tag} evaluating next iteration (code=0, iteration=${takeIteration}/${MAX_TAKE_ITERATIONS})`);
      (async () => {
        try {
          const nextTake = await buildNextTakePrompt();
          if (nextTake) {
            takeIteration++;
            const switchLabel = nextTake.agentOverride
              ? ` [agent: ${nextTake.agentOverride.label ?? nextTake.agentOverride.agentId ?? nextTake.agentOverride.command}]`
              : "";
            pushEvent({
              type: "stdout",
              data: `\n\x1b[36m--- Take ${takeIteration}/${MAX_TAKE_ITERATIONS}${switchLabel} ---\x1b[0m\n`,
              timestamp: Date.now(),
            });
            spawnTakeChild(nextTake.prompt, nextTake.beatState, nextTake.agentOverride);
            return;
          }
          console.log(`${tag} buildNextTakePrompt returned null — ending session`);
        } catch (err) {
          console.error(`${tag} buildNextTakePrompt threw:`, err);
          pushEvent({
            type: "stderr",
            data: `[take ${takeIteration}/${MAX_TAKE_ITERATIONS} | beat: ${beatId.slice(0, 12)}] Take loop check failed: ${err instanceof Error ? err.message : String(err)}\n`,
            timestamp: Date.now(),
          });
        }
        await enforceQueueTerminalInvariant();
        finishSession(takeCode ?? 0);
      })();
    });

    const takeErrorPrefix = `[take ${takeIteration}/${MAX_TAKE_ITERATIONS} | beat: ${beatId.slice(0, 12)} | agent: ${effectiveDialect}]`;

    takeChild.on("error", (err) => {
      console.error(`[terminal-manager] [${id}] [take-loop] spawn error:`, err.message);
      if (takeCloseInputTimer) { clearTimeout(takeCloseInputTimer); takeCloseInputTimer = null; }
      takeStdinClosed = true;
      pushEvent({ type: "stderr", data: `${takeErrorPrefix} Process error: ${err.message}\n`, timestamp: Date.now() });
      takeChild.stdout?.removeAllListeners();
      takeChild.stderr?.removeAllListeners();
      entry.process = null;
      finishSession(1);
    });

    // Log beat state before sending the take-loop prompt.
    interactionLog.logBeatState({
      beatId,
      state: beatState ?? "unknown",
      phase: "before_prompt",
      iteration: takeIteration,
    });

    // For interactive (claude) agents the prompt is sent via stdin;
    // for one-shot (codex) agents it was already passed as a CLI arg.
    if (effectiveIsInteractive) {
      const sent = takeSendUserTurn(takePrompt, `take_${takeIteration}`);
      if (!sent) {
        takeCloseInput();
        pushEvent({ type: "stderr", data: `${takeErrorPrefix} Failed to send prompt — stdin is closed or unavailable.\n`, timestamp: Date.now() });
        takeChild.kill("SIGTERM");
        entry.process = null;
        finishSession(1);
      }
    } else {
      // For one-shot (codex) agents the prompt was passed as a CLI arg;
      // log it here so history shows what was sent.
      interactionLog.logPrompt(takePrompt, { source: `take_${takeIteration}` });
    }
  };

  const child = spawn(agentCmd, args, {
    cwd,
    env: { ...process.env },
    stdio: [isInteractive ? "pipe" : "ignore", "pipe", "pipe"],
  });
  entry.process = child;

  console.log(`[terminal-manager]   agent: ${agent.command}${agent.model ? ` (model: ${agent.model})` : ""}`);
  console.log(`[terminal-manager]   pid: ${child.pid ?? "failed to spawn"}`);


  let stdinClosed = !isInteractive;
  let closeInputTimer: NodeJS.Timeout | null = null;
  const autoAnsweredToolUseIds = new Set<string>();
  const autoExecutionPrompt: string | null = null;
  const autoShipCompletionPrompt = !isInteractive
    ? null
    : customPrompt
      ? null
      : memoryManagerType === "knots"
        ? null
      : isParent
        ? buildWaveCompletionFollowUp(
          bead.id,
          sceneTargets,
          memoryManagerType,
        )
        : buildSingleBeadCompletionFollowUp(
          primaryTarget,
          memoryManagerType,
        );
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

  const sendUserTurn = (text: string, source = "manual"): boolean => {
    if (!child.stdin || child.stdin.destroyed || child.stdin.writableEnded || stdinClosed) {
      return false;
    }
    cancelInputClose();
    const line = makeUserMessageLine(text);
    try {
      child.stdin.write(line);
      interactionLog.logPrompt(text, { source });
      return true;
    } catch {
      return false;
    }
  };

  const maybeSendExecutionPrompt = (): boolean => {
    if (!autoExecutionPrompt || executionPromptSent) return false;
    const sent = sendUserTurn(autoExecutionPrompt, "execution_follow_up");
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
    const sent = sendUserTurn(autoShipCompletionPrompt, "ship_completion_follow_up");
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
      const sent = sendUserTurn(autoResponse, "auto_ask_user_response");

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
    interactionLog.logStdout(chunk.toString());
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
    interactionLog.logStderr(text);
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

    const tag = `[terminal-manager] [${id}] [take-loop]`;

    if (isTakeLoop) {
      console.log(`${tag} initial child close: code=${code} signal=${signal} beat=${beatId} isTakeLoop=${isTakeLoop}`);
      getBackend().get(beatId, repoPath).then((r) => {
        const state = r.ok && r.data ? r.data.state : "unknown";
        const claimable = r.ok && r.data ? r.data.isAgentClaimable : "unknown";
        console.log(`${tag} post-close beat state: beat=${beatId} state=${state} isAgentClaimable=${claimable}`);
        interactionLog.logBeatState({
          beatId,
          state,
          phase: "after_prompt",
          iteration: takeIteration,
        });
      }).catch(() => {
        console.log(`${tag} post-close beat fetch failed: beat=${beatId}`);
      });
    } else {
      console.log(`[terminal-manager] [${id}] close: code=${code} signal=${signal} buffer=${buffer.length} events`);
    }
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;

    // Release child process stream listeners to free closures
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;

    // Take loop: check if knots-backed session should continue claiming the same beat
    if (isTakeLoop && code !== 0) {
      console.log(`${tag} STOP: initial child exited with non-zero code=${code}`);
      enforceQueueTerminalInvariant().finally(() => {
        finishSession(code ?? 1);
      });
      return;
    }

    if (isTakeLoop && code === 0 && takeIteration >= MAX_TAKE_ITERATIONS) {
      console.log(`${tag} STOP: max iterations reached (${takeIteration}/${MAX_TAKE_ITERATIONS})`);
      pushEvent({
        type: "stdout",
        data: `\x1b[33m--- Take loop stopped: max ${MAX_TAKE_ITERATIONS} iterations reached ---\x1b[0m\n`,
        timestamp: Date.now(),
      });
      enforceQueueTerminalInvariant().finally(() => {
        finishSession(code ?? 1);
      });
      return;
    }

    if (isTakeLoop && code === 0 && takeIteration < MAX_TAKE_ITERATIONS) {
      console.log(`${tag} evaluating next iteration after initial child (code=0, iteration=${takeIteration}/${MAX_TAKE_ITERATIONS})`);
      (async () => {
        try {
          const nextTake = await buildNextTakePrompt();
          if (nextTake) {
            takeIteration++;
            const switchLabel = nextTake.agentOverride
              ? ` [agent: ${nextTake.agentOverride.label ?? nextTake.agentOverride.agentId ?? nextTake.agentOverride.command}]`
              : "";
            pushEvent({
              type: "stdout",
              data: `\n\x1b[36m--- Take ${takeIteration}/${MAX_TAKE_ITERATIONS}${switchLabel} ---\x1b[0m\n`,
              timestamp: Date.now(),
            });
            console.log(`${tag} starting iteration ${takeIteration}/${MAX_TAKE_ITERATIONS}`);
            spawnTakeChild(nextTake.prompt, nextTake.beatState, nextTake.agentOverride);
            return;
          }
          console.log(`${tag} buildNextTakePrompt returned null — ending session`);
        } catch (err) {
          console.error(`${tag} buildNextTakePrompt threw:`, err);
          pushEvent({
            type: "stderr",
            data: `[take ${takeIteration}/${MAX_TAKE_ITERATIONS} | beat: ${beatId.slice(0, 12)}] Take loop check failed: ${err instanceof Error ? err.message : String(err)}\n`,
            timestamp: Date.now(),
          });
        }
        await enforceQueueTerminalInvariant();
        finishSession(code ?? 0);
      })();
      return;
    }

    if (isTakeLoop) {
      (async () => {
        await enforceQueueTerminalInvariant();
        finishSession(code ?? 1);
      })();
      return;
    }

    finishSession(code ?? 1);
  });

  child.on("error", (err) => {
    console.error(`[terminal-manager] [${id}] spawn error:`, err.message);
    if (closeInputTimer) {
      clearTimeout(closeInputTimer);
      closeInputTimer = null;
    }
    stdinClosed = true;
    pushEvent({
      type: "stderr",
      data: `Process error: ${err.message}`,
      timestamp: Date.now(),
    });
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;
    finishSession(1);
  });

  // Log beat state before the initial prompt (iteration 1).
  if (isTakeLoop) {
    interactionLog.logBeatState({
      beatId,
      state: bead.state ?? "unknown",
      phase: "before_prompt",
      iteration: takeIteration,
    });
  }

  // For interactive (claude) agents the prompt is sent via stdin;
  // for one-shot (codex) agents it was already passed as a CLI arg.
  if (isInteractive) {
    const initialPromptSent = sendUserTurn(prompt, "initial");
    if (!initialPromptSent) {
      closeInput();
      session.status = "error";
      interactionLog.logEnd(1, "error");
      child.kill("SIGTERM");
      sessions.delete(id);
      const agentDesc = `${agent.label || agent.command}${agent.model ? ` (model: ${agent.model})` : ""}`;
      throw new Error(`Failed to send initial prompt to agent: ${agentDesc}`);
    }
  } else {
    // For one-shot (codex) agents the prompt was passed as a CLI arg;
    // log it here so history shows what was sent.
    interactionLog.logPrompt(prompt, { source: "initial" });
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
