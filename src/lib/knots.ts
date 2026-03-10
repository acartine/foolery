import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import type { BdResult, Invariant } from "./types";
import { classifyErrorMessage, isRetryableByDefault } from "./backend-errors";
import { logCliFailure } from "./server-logger";

const KNOTS_BIN = process.env.KNOTS_BIN ?? "kno";
const KNOTS_DB_PATH = process.env.KNOTS_DB_PATH;
const COMMAND_TIMEOUT_MS = envInt("FOOLERY_KNOTS_COMMAND_TIMEOUT_MS", 20000);

const RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const repoWriteQueues = new Map<string, { tail: Promise<void>; pending: number }>();
const nextKnotQueues = new Map<string, { tail: Promise<void>; pending: number }>();

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecOptions {
  repoPath?: string;
}

export interface KnotRecord {
  id: string;
  title: string;
  state: string;
  profile_id?: string;
  profile_etag?: string | null;
  workflow_id?: string;
  updated_at: string;
  body?: string | null;
  description?: string | null;
  priority?: number | null;
  type?: string | null;
  tags?: string[];
  aliases?: string[];
  notes?: Array<Record<string, unknown>>;
  handoff_capsules?: Array<Record<string, unknown>>;
  steps?: Array<Record<string, unknown>>;
  step_history?: Array<Record<string, unknown>>;
  stepHistory?: Array<Record<string, unknown>>;
  timeline?: Array<Record<string, unknown>>;
  transitions?: Array<Record<string, unknown>>;
  invariants?: Invariant[];
  workflow_etag?: string | null;
  created_at?: string | null;
}

export interface KnotWorkflowDefinition {
  id: string;
  description?: string | null;
  initial_state: string;
  states: string[];
  terminal_states: string[];
  transitions?: Array<{ from: string; to: string }>;
}

export interface KnotProfileOwners {
  planning: { kind: "agent" | "human" };
  plan_review: { kind: "agent" | "human" };
  implementation: { kind: "agent" | "human" };
  implementation_review: { kind: "agent" | "human" };
  shipment: { kind: "agent" | "human" };
  shipment_review: { kind: "agent" | "human" };
}

export interface KnotProfileDefinition {
  id: string;
  aliases?: string[];
  description?: string | null;
  planning_mode?: "required" | "optional" | "skipped";
  implementation_review_mode?: "required" | "optional" | "skipped";
  output?: "remote_main" | "pr" | "remote" | "local";
  owners: KnotProfileOwners;
  initial_state: string;
  states: string[];
  terminal_states: string[];
  transitions?: Array<{ from: string; to: string }>;
}

export interface KnotClaimPrompt {
  id: string;
  title: string;
  state: string;
  profile_id: string;
  type?: string;
  priority?: number | null;
  invariants?: Invariant[];
  prompt: string;
}

export interface KnotEdge {
  src: string;
  kind: string;
  dst: string;
}

export interface KnotUpdateInput {
  title?: string;
  description?: string;
  priority?: number;
  status?: string;
  type?: string;
  addTags?: string[];
  removeTags?: string[];
  addNote?: string;
  noteUsername?: string;
  noteDatetime?: string;
  noteAgentname?: string;
  noteModel?: string;
  noteVersion?: string;
  addHandoffCapsule?: string;
  handoffUsername?: string;
  handoffDatetime?: string;
  handoffAgentname?: string;
  handoffModel?: string;
  handoffVersion?: string;
  addInvariants?: string[];
  removeInvariants?: string[];
  clearInvariants?: boolean;
  force?: boolean;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveRepoPath(repoPath?: string): string {
  return resolve(repoPath ?? process.cwd());
}

function buildBaseArgs(repoPath?: string): string[] {
  const rp = resolveRepoPath(repoPath);
  const dbPath = KNOTS_DB_PATH ?? join(rp, ".knots", "cache", "state.sqlite");
  return ["--repo-root", rp, "--db", dbPath];
}

async function exec(args: string[], options?: ExecOptions): Promise<ExecResult> {
  const repoPath = resolveRepoPath(options?.repoPath);
  const fullArgs = [...buildBaseArgs(repoPath), ...args];

  return new Promise((resolveExec) => {
    execFile(
      KNOTS_BIN,
      fullArgs,
      {
        cwd: repoPath,
        timeout: COMMAND_TIMEOUT_MS,
        killSignal: "SIGKILL",
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        const execError = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        let stderrText = (stderr ?? "").trim();
        if (execError?.killed) {
          const timeoutMsg = `knots command timed out after ${COMMAND_TIMEOUT_MS}ms`;
          stderrText = stderrText ? `${timeoutMsg}\n${stderrText}` : timeoutMsg;
        }
        const exitCode =
          execError && typeof execError.code === "number" ? execError.code : execError ? 1 : 0;

        if (exitCode !== 0) {
          const cmdLabel = args.slice(0, 3).join(" ");
          console.warn(
            `[knots] kno ${cmdLabel} exited ${exitCode}${stderrText ? `: ${stderrText}` : ""}`,
          );
          logCliFailure({ command: KNOTS_BIN, args: fullArgs, exitCode, stderr: stderrText });
        }

        resolveExec({
          stdout: (stdout ?? "").trim(),
          stderr: stderrText,
          exitCode,
        });
      },
    );
  });
}

async function withWriteSerialization<T>(
  repoPath: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const key = resolveRepoPath(repoPath);
  let state = repoWriteQueues.get(key);
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0 };
    repoWriteQueues.set(key, state);
  }

  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    releaseQueue = resolveGate;
  });

  const waitForTurn = state.tail;
  state.tail = waitForTurn.then(
    () => gate,
    () => gate,
  );
  state.pending += 1;

  try {
    await waitForTurn;
    return await run();
  } finally {
    releaseQueue();
    state.pending -= 1;
    if (state.pending === 0) {
      repoWriteQueues.delete(key);
    }
  }
}

async function withNextKnotSerialization<T>(
  knotId: string,
  run: () => Promise<T>,
): Promise<T> {
  let state = nextKnotQueues.get(knotId);
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0 };
    nextKnotQueues.set(knotId, state);
  }

  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    releaseQueue = resolveGate;
  });

  const waitForTurn = state.tail;
  state.tail = waitForTurn.then(
    () => gate,
    () => gate,
  );
  state.pending += 1;

  try {
    await waitForTurn;
    return await run();
  } finally {
    releaseQueue();
    state.pending -= 1;
    if (state.pending === 0) {
      nextKnotQueues.delete(knotId);
    }
  }
}

async function execWrite(
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return withWriteSerialization(options?.repoPath, () => exec(args, options));
}

/**
 * Retries a write operation on transient errors (e.g. "database is locked")
 * using exponential backoff: 1s, 2s, 4s delays before giving up.
 */
async function execWriteWithRetry(
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  let result = await execWrite(args, options);
  for (const delayMs of RETRY_DELAYS_MS) {
    if (result.exitCode === 0) return result;
    const code = classifyErrorMessage(result.stderr);
    if (!isRetryableByDefault(code)) return result;
    const cmdLabel = args.slice(0, 3).join(" ");
    console.warn(`[knots] retrying kno ${cmdLabel} in ${delayMs}ms (${code})`);
    await sleep(delayMs);
    result = await execWrite(args, options);
  }
  return result;
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function workflowToLegacyProfile(workflow: KnotWorkflowDefinition): KnotProfileDefinition {
  const modeHint = [workflow.id, workflow.description ?? ""].join(" ").toLowerCase();
  const humanReview = /semiauto|coarse|human|gated/.test(modeHint);
  return {
    id: workflow.id,
    aliases: [],
    description: workflow.description ?? undefined,
    planning_mode: "required",
    implementation_review_mode: "required",
    output: "remote_main",
    owners: {
      planning: { kind: "agent" },
      plan_review: { kind: humanReview ? "human" : "agent" },
      implementation: { kind: "agent" },
      implementation_review: { kind: humanReview ? "human" : "agent" },
      shipment: { kind: "agent" },
      shipment_review: { kind: "agent" },
    },
    initial_state: workflow.initial_state,
    states: workflow.states,
    terminal_states: workflow.terminal_states,
    transitions: workflow.transitions,
  };
}

export async function listKnots(repoPath?: string): Promise<BdResult<KnotRecord[]>> {
  const withAll = await exec(["ls", "--all", "--json"], { repoPath });
  if (withAll.exitCode === 0) {
    try {
      return { ok: true, data: parseJson<KnotRecord[]>(withAll.stdout) };
    } catch {
      return { ok: false, error: "Failed to parse knots ls output" };
    }
  }

  const fallback = await exec(["ls", "--json"], { repoPath });
  if (fallback.exitCode !== 0) {
    return {
      ok: false,
      error: fallback.stderr || withAll.stderr || "knots ls failed",
    };
  }
  try {
    return { ok: true, data: parseJson<KnotRecord[]>(fallback.stdout) };
  } catch {
    return { ok: false, error: "Failed to parse knots ls output" };
  }
}

export async function listProfiles(repoPath?: string): Promise<BdResult<KnotProfileDefinition[]>> {
  const primary = await exec(["profile", "list", "--json"], { repoPath });
  if (primary.exitCode === 0) {
    try {
      return { ok: true, data: parseJson<KnotProfileDefinition[]>(primary.stdout) };
    } catch {
      return { ok: false, error: "Failed to parse knots profile list output" };
    }
  }

  const fallback = await exec(["profile", "ls", "--json"], { repoPath });
  if (fallback.exitCode === 0) {
    try {
      return { ok: true, data: parseJson<KnotProfileDefinition[]>(fallback.stdout) };
    } catch {
      return { ok: false, error: "Failed to parse knots profile list output" };
    }
  }

  const workflowFallback = await listWorkflows(repoPath);
  if (!workflowFallback.ok) {
    return {
      ok: false,
      error:
        fallback.stderr ||
        primary.stderr ||
        workflowFallback.error ||
        "knots profile list failed",
    };
  }

  return {
    ok: true,
    data: (workflowFallback.data ?? []).map(workflowToLegacyProfile),
  };
}

export async function listWorkflows(repoPath?: string): Promise<BdResult<KnotWorkflowDefinition[]>> {
  const listResult = await exec(["workflow", "list", "--json"], { repoPath });
  if (listResult.exitCode === 0) {
    try {
      return { ok: true, data: parseJson<KnotWorkflowDefinition[]>(listResult.stdout) };
    } catch {
      return { ok: false, error: "Failed to parse knots workflow list output" };
    }
  }

  const fallbackResult = await exec(["workflow", "ls", "--json"], { repoPath });
  if (fallbackResult.exitCode !== 0) {
    return {
      ok: false,
      error: fallbackResult.stderr || listResult.stderr || "knots workflow list failed",
    };
  }

  try {
    return { ok: true, data: parseJson<KnotWorkflowDefinition[]>(fallbackResult.stdout) };
  } catch {
    return { ok: false, error: "Failed to parse knots workflow list output" };
  }
}

export async function showKnot(id: string, repoPath?: string): Promise<BdResult<KnotRecord>> {
  const { stdout, stderr, exitCode } = await exec(["show", id, "--json"], { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots show failed" };
  try {
    return { ok: true, data: parseJson<KnotRecord>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse knots show output" };
  }
}

export async function newKnot(
  title: string,
  options?: { description?: string; body?: string; state?: string; profile?: string; workflow?: string },
  repoPath?: string,
): Promise<BdResult<{ id: string }>> {
  const args = ["new"];
  const description = options?.description ?? options?.body;
  if (description) args.push(`--desc=${description}`);
  if (options?.state) args.push("--state", options.state);

  const selectedProfile = options?.profile ?? options?.workflow;
  if (selectedProfile) args.push("--profile", selectedProfile);

  args.push("--", title);

  const { stdout, stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots new failed" };

  const match = /^created\s+(\S+)/m.exec(stdout);
  if (!match?.[1]) {
    return { ok: false, error: "Failed to parse knots new output" };
  }

  return { ok: true, data: { id: match[1] } };
}

export interface ClaimKnotOptions {
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
}

export async function claimKnot(
  id: string,
  repoPath?: string,
  options?: ClaimKnotOptions,
): Promise<BdResult<KnotClaimPrompt>> {
  const args = ["claim", id, "--json"];
  if (options?.agentName) args.push("--agent-name", options.agentName);
  if (options?.agentModel) args.push("--agent-model", options.agentModel);
  if (options?.agentVersion) args.push("--agent-version", options.agentVersion);
  const { stdout, stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots claim failed" };
  try {
    return { ok: true, data: parseJson<KnotClaimPrompt>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse knots claim output" };
  }
}

export async function skillPrompt(
  stateOrId: string,
  repoPath?: string,
): Promise<BdResult<string>> {
  const { stdout, stderr, exitCode } = await exec(["skill", stateOrId], { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots skill failed" };
  return { ok: true, data: stdout };
}

export interface NextKnotOptions {
  actorKind?: string;
  expectedState?: string;
}

export async function nextKnot(
  id: string,
  repoPath?: string,
  options?: NextKnotOptions,
): Promise<BdResult<void>> {
  return withNextKnotSerialization(id, async () => {
    const args = ["next", id];
    if (options?.expectedState) args.push("--expected-state", options.expectedState);
    if (options?.actorKind) args.push("--actor-kind", options.actorKind);
    const { stderr, exitCode } = await execWriteWithRetry(args, { repoPath });
    if (exitCode !== 0) return { ok: false, error: stderr || "knots next failed" };
    return { ok: true };
  });
}

export interface SetKnotProfileOptions {
  state?: string;
  ifMatch?: string;
}

export async function setKnotProfile(
  id: string,
  profile: string,
  repoPath?: string,
  options?: SetKnotProfileOptions,
): Promise<BdResult<void>> {
  const args = ["profile", "set", id, profile];
  if (options?.state) args.push("--state", options.state);
  if (options?.ifMatch) args.push("--if-match", options.ifMatch);
  const { stderr, exitCode } = await execWriteWithRetry(args, { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots profile set failed" };
  return { ok: true };
}

export interface PollKnotOptions {
  stage?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
}

export async function pollKnot(
  repoPath?: string,
  options?: PollKnotOptions,
): Promise<BdResult<KnotClaimPrompt>> {
  const args = ["poll", "--claim", "--json"];
  if (options?.stage) args.push(options.stage);
  if (options?.agentName) args.push("--agent-name", options.agentName);
  if (options?.agentModel) args.push("--agent-model", options.agentModel);
  if (options?.agentVersion) args.push("--agent-version", options.agentVersion);
  const { stdout, stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots poll --claim failed" };
  try {
    return { ok: true, data: parseJson<KnotClaimPrompt>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse knots poll output" };
  }
}

export async function updateKnot(
  id: string,
  input: KnotUpdateInput,
  repoPath?: string,
): Promise<BdResult<void>> {
  const args = ["update", id];

  if (input.title !== undefined) args.push(`--title=${input.title}`);
  if (input.description !== undefined) args.push(`--description=${input.description}`);
  if (input.priority !== undefined) args.push("--priority", String(input.priority));
  if (input.status !== undefined) args.push("--status", input.status);
  if (input.type !== undefined) args.push("--type", input.type);

  for (const tag of input.addTags ?? []) {
    if (tag.trim()) args.push(`--add-tag=${tag}`);
  }
  for (const tag of input.removeTags ?? []) {
    if (tag.trim()) args.push(`--remove-tag=${tag}`);
  }

  if (input.addNote !== undefined) {
    args.push(`--add-note=${input.addNote}`);
    args.push("--note-username", input.noteUsername || "foolery");
    if (input.noteDatetime) args.push("--note-datetime", input.noteDatetime);
    args.push("--note-agentname", input.noteAgentname || "foolery");
    if (input.noteModel) args.push("--note-model", input.noteModel);
    if (input.noteVersion) args.push("--note-version", input.noteVersion);
  }

  if (input.addHandoffCapsule !== undefined) {
    args.push(`--add-handoff-capsule=${input.addHandoffCapsule}`);
    args.push("--handoff-username", input.handoffUsername || "foolery");
    if (input.handoffDatetime) args.push("--handoff-datetime", input.handoffDatetime);
    args.push("--handoff-agentname", input.handoffAgentname || "foolery");
    if (input.handoffModel) args.push("--handoff-model", input.handoffModel);
    if (input.handoffVersion) args.push("--handoff-version", input.handoffVersion);
  }

  for (const inv of input.addInvariants ?? []) {
    const normalized = inv.trim();
    if (normalized) args.push(`--add-invariant=${normalized}`);
  }
  for (const inv of input.removeInvariants ?? []) {
    const normalized = inv.trim();
    if (normalized) args.push(`--remove-invariant=${normalized}`);
  }
  if (input.clearInvariants) args.push("--clear-invariants");

  if (input.force) args.push("--force");

  const { stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots update failed" };
  return { ok: true };
}

export async function listEdges(
  id: string,
  direction: "incoming" | "outgoing" | "both" = "both",
  repoPath?: string,
): Promise<BdResult<KnotEdge[]>> {
  const { stdout, stderr, exitCode } = await exec(
    ["edge", "list", id, "--direction", direction, "--json"],
    { repoPath },
  );
  if (exitCode !== 0) return { ok: false, error: stderr || "knots edge list failed" };
  try {
    return { ok: true, data: parseJson<KnotEdge[]>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse knots edge list output" };
  }
}

export async function addEdge(
  src: string,
  kind: string,
  dst: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await execWrite(["edge", "add", src, kind, dst], { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots edge add failed" };
  return { ok: true };
}

export async function removeEdge(
  src: string,
  kind: string,
  dst: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await execWrite(["edge", "remove", src, kind, dst], { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots edge remove failed" };
  return { ok: true };
}

/** @internal Exposed for testing only. */
export function _pendingWriteCount(repoPath?: string): number {
  const key = resolveRepoPath(repoPath);
  return repoWriteQueues.get(key)?.pending ?? 0;
}

/** @internal Exposed for testing only. */
export function _pendingNextCount(knotId: string): number {
  return nextKnotQueues.get(knotId)?.pending ?? 0;
}
