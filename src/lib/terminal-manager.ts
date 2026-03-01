import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { getBackend } from "@/lib/backend-instance";
import {
  startInteractionLog,
  noopInteractionLog,
  type InteractionLog,
} from "@/lib/interaction-logger";
import { regroomAncestors } from "@/lib/regroom";
import { getActionAgent, loadSettings } from "@/lib/settings";
import {
  buildPromptModeArgs,
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import type { MemoryManagerType } from "@/lib/memory-managers";
import {
  buildClaimCommand,
  buildShowIssueCommand,
  buildWorkflowStateCommand,
  resolveMemoryManagerType,
} from "@/lib/memory-manager-commands";
import { validateCwd } from "@/lib/validate-cwd";
import type { TerminalSession, TerminalEvent } from "@/lib/types";
import { ORCHESTRATION_WAVE_LABEL } from "@/lib/wave-slugs";
import { onAgentComplete } from "@/lib/verification-orchestrator";
import { updateMessageTypeIndexFromSession } from "@/lib/agent-message-type-index";
import type { Beat, CoarsePrPreference, MemoryWorkflowDescriptor } from "@/lib/types";
import {
  beadsCoarseWorkflowDescriptor,
  resolveCoarsePrPreference,
  workflowDescriptorById,
} from "@/lib/workflows";

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

interface WorkflowPromptTarget {
  id: string;
  workflow: MemoryWorkflowDescriptor;
  workflowState?: string;
}

function buildCoarsePolicyLines(policy: CoarsePrPreference): string[] {
  switch (policy) {
    case "soft_required":
      return [
        "PR policy: soft-required.",
        "Open a PR before handing off to the required human-action queue. If impossible, explicitly state why and continue only with that explicit exception.",
      ];
    case "preferred":
      return [
        "PR policy: preferred.",
        "Open a PR when practical, then continue.",
      ];
    case "none":
      return [
        "PR policy: none.",
      ];
    default:
      return [];
  }
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

  return progression.map((state) =>
    buildWorkflowStateCommand(target.id, state, memoryManagerType),
  );
}

function buildSingleTargetFollowUpLines(
  target: WorkflowPromptTarget,
  memoryManagerType: MemoryManagerType,
  coarsePrPolicy: CoarsePrPreference,
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

  lines.push(...buildCoarsePolicyLines(coarsePrPolicy));
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
  coarsePrPolicy: CoarsePrPreference,
): string {
  return [
    "Ship completion follow-up:",
    `Confirm that changes for ${target.id} are merged and pushed according to your normal shipping guidelines.`,
    "Do not ask for another follow-up prompt until merge/push confirmation is done (or blocked by a hard error).",
    ...buildSingleTargetFollowUpLines(target, memoryManagerType, coarsePrPolicy),
    "Then summarize merge/push confirmation and workflow command results.",
  ].join("\n");
}

function buildWaveCompletionFollowUp(
  waveId: string,
  targets: WorkflowPromptTarget[],
  memoryManagerType: MemoryManagerType,
  coarsePolicyByWorkflowId: Map<string, CoarsePrPreference>,
): string {
  const safeTargets = targets.length > 0
    ? targets
    : [{ id: waveId, workflow: beadsCoarseWorkflowDescriptor() }];
  return [
    "Scene completion follow-up:",
    `Handle this in one pass for scene ${waveId}.`,
    "For EACH bead below, confirm merge/push status before workflow transitions.",
    "Do not ask for another follow-up prompt until all listed beats are merge-confirmed (or blocked by a hard error).",
    ...safeTargets.flatMap((target) => buildSingleTargetFollowUpLines(
      target,
      memoryManagerType,
      coarsePolicyByWorkflowId.get(target.workflow.id) ?? "soft_required",
    )),
    "Then summarize per bead: merged yes/no, pushed yes/no, workflow command results, and PR/review notes when applicable.",
  ].join("\n");
}

function buildSceneCompletionFollowUp(
  targets: WorkflowPromptTarget[],
  memoryManagerType: MemoryManagerType,
  coarsePolicyByWorkflowId: Map<string, CoarsePrPreference>,
): string {
  return buildWaveCompletionFollowUp(
    "scene",
    targets,
    memoryManagerType,
    coarsePolicyByWorkflowId,
  );
}

function buildKnotsClaimModeLines(
  beatIds: string[],
  memoryManagerType: MemoryManagerType,
): string[] {
  if (memoryManagerType !== "knots") return [];
  const ids = beatIds.length > 0 ? beatIds : ["<id>"];
  const lines: string[] = [
    "KNOTS CLAIM MODE (required):",
    "Always claim a knot before implementation and follow the claim output verbatim.",
  ];
  for (const id of ids) {
    lines.push(`- Run \`${buildClaimCommand(id, memoryManagerType)}\` first.`);
    lines.push(`- Use the returned \`prompt\` field as the source of truth for ${id}.`);
    lines.push(`- Run the completion command from that claim output, then stop work on ${id}.`);
  }
  lines.push("- Do not guess or brute-force workflow transitions outside the claim output.");
  return lines;
}

function assertKnotsClaimable(beats: Beat[], action: "Take" | "Scene"): void {
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
  const bead = result.data;
  const isWave = bead.labels?.includes(ORCHESTRATION_WAVE_LABEL) ?? false;
  // Check for children — both orchestrated waves and plain parent beads
  let waveBeatIds: string[] = [];
  let waveBeats: Beat[] = [];
  const childResult = await getBackend().list({ parent: bead.id }, repoPath);
  const hasChildren = childResult.ok && childResult.data && childResult.data.length > 0;
  if (hasChildren) {
    waveBeats = childResult.data!
      .filter((child) => child.state !== "closed")
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
    assertKnotsClaimable(isParent ? waveBeats : [bead], isParent ? "Scene" : "Take");
  }
  const workflowsResult = await getBackend().listWorkflows(repoPath);
  const workflows = workflowsResult.ok ? workflowsResult.data ?? [] : [];
  const workflowsById = workflowDescriptorById(workflows);
  const fallbackWorkflow = workflows[0] ?? beadsCoarseWorkflowDescriptor();
  const settings = await loadSettings();
  const coarseOverrides = settings.workflow?.coarsePrPreferenceOverrides ?? {};
  const coarsePolicyByWorkflowId = new Map<string, CoarsePrPreference>();
  for (const workflow of workflows) {
    coarsePolicyByWorkflowId.set(
      workflow.id,
      resolveCoarsePrPreference(resolvedRepoPath, workflow, coarseOverrides),
    );
  }
  if (!coarsePolicyByWorkflowId.has(fallbackWorkflow.id)) {
    coarsePolicyByWorkflowId.set(
      fallbackWorkflow.id,
      resolveCoarsePrPreference(resolvedRepoPath, fallbackWorkflow, coarseOverrides),
    );
  }
  const primaryTarget = toWorkflowPromptTarget(bead, workflowsById, fallbackWorkflow);
  const sceneTargets = waveBeats.map((child) =>
    toWorkflowPromptTarget(child, workflowsById, fallbackWorkflow),
  );

  // Resolve agent early so we can pass metadata to buildTakePrompt
  const agent = await getActionAgent("take");

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
        agentName: agent.label || agent.command,
        agentModel: agent.model,
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
  const primaryCoarsePolicy =
    coarsePolicyByWorkflowId.get(primaryTarget.workflow.id) ?? "soft_required";
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
          coarsePolicyByWorkflowId,
        )
        : buildSingleBeadCompletionFollowUp(
          primaryTarget,
          memoryManagerType,
          primaryCoarsePolicy,
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
      regroomAncestors(beatId, cwd).catch((err) => {
        console.error(`[terminal-manager] regroom failed for ${beatId}:`, err);
      });

      // Trigger auto-verification workflow for code-producing actions
      const actionBeatIds = isParent ? waveBeatIds : [beatId];
      onAgentComplete(actionBeatIds, "take", cwd, code ?? 1).catch((err) => {
        console.error(`[terminal-manager] verification hook failed for ${beatId}:`, err);
      });

      // Update message type index with types from this session
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

  const initialPromptSent = sendUserTurn(prompt, "initial");
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
  beatIds: string[],
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

  if (beatIds.length === 0) {
    throw new Error("At least one beat ID is required for a scene session");
  }

  // Fetch all beat details in parallel
  const beatResults = await Promise.all(
    beatIds.map((bid) => getBackend().get(bid, repoPath))
  );
  const beats = beatResults.map((r, i) => {
    if (!r.ok || !r.data) {
      throw new Error(`Failed to fetch beat ${beatIds[i]}: ${r.error?.message ?? "unknown error"}`);
    }
    return r.data;
  });

  const id = generateId();
  const resolvedRepoPath = repoPath || process.cwd();
  const memoryManagerType = resolveMemoryManagerType(resolvedRepoPath);
  if (memoryManagerType === "knots") {
    assertKnotsClaimable(beats, "Scene");
  }
  const workflowsResult = await getBackend().listWorkflows(repoPath);
  const workflows = workflowsResult.ok ? workflowsResult.data ?? [] : [];
  const workflowsById = workflowDescriptorById(workflows);
  const fallbackWorkflow = workflows[0] ?? beadsCoarseWorkflowDescriptor();
  const settings = await loadSettings();
  const coarseOverrides = settings.workflow?.coarsePrPreferenceOverrides ?? {};
  const coarsePolicyByWorkflowId = new Map<string, CoarsePrPreference>();
  for (const workflow of workflows) {
    coarsePolicyByWorkflowId.set(
      workflow.id,
      resolveCoarsePrPreference(resolvedRepoPath, workflow, coarseOverrides),
    );
  }
  if (!coarsePolicyByWorkflowId.has(fallbackWorkflow.id)) {
    coarsePolicyByWorkflowId.set(
      fallbackWorkflow.id,
      resolveCoarsePrPreference(resolvedRepoPath, fallbackWorkflow, coarseOverrides),
    );
  }
  const sceneTargets = beats.map((beat) =>
    toWorkflowPromptTarget(beat, workflowsById, fallbackWorkflow),
  );
  const showAnyCommand = buildShowIssueCommand("<id>", memoryManagerType);

  // Build combined prompt with bead IDs only (agents query details themselves)
  const beatBlocks = beats
    .map(
      (beat, i) =>
        `--- Beat ${i + 1} of ${beats.length} ---\nID: ${beat.id}`
    )
    .join("\n\n");

  const prompt =
    customPrompt ??
    [
      `You are in SCENE MODE. You have ${beats.length} beats to implement.`,
      ``,
      `IMPORTANT INSTRUCTIONS:`,
      `1. Execute immediately in accept-edits mode; do not enter plan mode and do not wait for an execution follow-up prompt.`,
      `2. Use \`${showAnyCommand}\` to inspect full bead details before starting implementation.`,
      `3. Use the Task tool to spawn subagents for independent beads to maximize parallelism.`,
      `4. Each subagent must run in a dedicated git worktree on an isolated short-lived branch.`,
      `5. Land final integrated changes on local main and push to origin/main. Do not require PRs unless explicitly requested.`,
      ...(memoryManagerType === "knots"
        ? [
            "6. Claim each knot before implementation and execute only the returned claim prompt.",
            ...buildKnotsClaimModeLines(beatIds, memoryManagerType),
            "7. In your final summary, report per knot: claim command status, completion command status, and any remaining human-action gates.",
          ]
        : [
            "6. For each bead, once merge/push is confirmed, apply workflow transitions according to its assigned workflow:",
            ...sceneTargets.flatMap((target) =>
              buildSingleTargetFollowUpLines(
                target,
                memoryManagerType,
                coarsePolicyByWorkflowId.get(target.workflow.id) ?? "soft_required",
              )
            ),
            "7. In your final summary, report per bead: merged yes/no, pushed yes/no, workflow command result, and PR/review status when applicable.",
          ]),
      ``,
      `AUTONOMY: This is non-interactive Ship mode. If you call AskUserQuestion, the system may auto-answer using deterministic defaults. Prefer making reasonable assumptions and continue when possible.`,
      ``,
      beatBlocks,
      `\nUse \`${showAnyCommand}\` to inspect full bead details before starting implementation.`,
    ].join("\n");

  const session: TerminalSession = {
    id,
    beatId: "scene",
    beatTitle: `Scene: ${beats.length} beats`,
    beatIds,
    repoPath: resolvedRepoPath,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  const buffer: TerminalEvent[] = [];

  const agent = await getActionAgent("scene");

  const sceneInteractionLog = await startInteractionLog({
    sessionId: id,
    interactionType: "scene",
    repoPath: resolvedRepoPath,
    beatIds,
    agentName: agent.label || agent.command,
    agentModel: agent.model,
  }).catch((err) => {
    console.error(`[terminal-manager] Failed to start interaction log:`, err);
    return noopInteractionLog();
  });

  const entry: SessionEntry = { session, process: null, emitter, buffer, interactionLog: sceneInteractionLog };
  sessions.set(id, entry);

  const cwd = resolvedRepoPath;

  const pushEvent = (evt: TerminalEvent) => {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(evt);
    emitter.emit("data", evt);
  };

  // Validate CWD exists before spawning — emit structured error on failure
  // so classifyTerminalFailure detects it as a missing_cwd failure.
  const sceneCwdError = await validateCwd(cwd);
  if (sceneCwdError) {
    console.error(`[terminal-manager] CWD validation failed for scene session ${id}: ${cwd}`);
    session.status = "error";
    sceneInteractionLog.logEnd(1, "error");
    pushEvent({ type: "stderr", data: `${sceneCwdError}\n`, timestamp: Date.now() });
    pushEvent({ type: "exit", data: "1", timestamp: Date.now() });
    setTimeout(() => { emitter.removeAllListeners(); }, 2000);
    setTimeout(() => { buffer.length = 0; sessions.delete(id); }, CLEANUP_DELAY_MS);
    return session;
  }

  console.log(`[terminal-manager] Creating scene session ${id}`);
  console.log(`[terminal-manager]   beatIds: ${beatIds.join(", ")}`);
  console.log(`[terminal-manager]   cwd: ${cwd}`);
  console.log(`[terminal-manager]   prompt: ${prompt.slice(0, 120)}...`);
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

  let stdinClosed = !sceneIsInteractive;
  let closeInputTimer: NodeJS.Timeout | null = null;
  const autoAnsweredToolUseIds = new Set<string>();
  const autoExecutionPrompt: string | null = null;
  const autoShipCompletionPrompt = !sceneIsInteractive
    ? null
    : customPrompt
      ? null
      : memoryManagerType === "knots"
        ? null
      : buildSceneCompletionFollowUp(
        sceneTargets,
        memoryManagerType,
        coarsePolicyByWorkflowId,
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
      sceneInteractionLog.logPrompt(text, { source });
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
    const sent = sendUserTurn(autoShipCompletionPrompt, "scene_completion_follow_up");
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
        beatIds.map((bid) => regroomAncestors(bid, cwd))
      ).catch((err) => {
        console.error(`[terminal-manager] regroom failed for scene:`, err);
      });

      // Trigger auto-verification workflow for scene beads
      onAgentComplete(beatIds, "scene", cwd, code ?? 1).catch((err) => {
        console.error(`[terminal-manager] verification hook failed for scene:`, err);
      });

      // Update message type index with types from this scene session
      const sceneLogFile = sceneInteractionLog.filePath;
      if (sceneLogFile) {
        updateMessageTypeIndexFromSession(
          sceneLogFile,
          agent.label || agent.command,
          agent.model,
        ).catch((err) => {
          console.error(`[terminal-manager] message type index update failed for scene:`, err);
        });
      }
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

  const initialPromptSent = sendUserTurn(prompt, "initial");
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
