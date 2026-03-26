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
  /** Singular alias returned by `kno show --json` / `kno ls --json`. */
  alias?: string | null;
  /** Array form (may be absent from CLI output; prefer {@link collectAliases}). */
  aliases?: string[];
  title: string;
  state: string;
  profile_id?: string;
  profile_etag?: string | null;
  workflow_id?: string;
  updated_at: string;
  body?: string | null;
  description?: string | null;
  acceptance?: string | null;
  priority?: number | null;
  type?: string | null;
  tags?: string[];
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
  lease_id?: string | null;
  lease?: {
    lease_type: string;
    nickname: string;
    agent_info?: {
      agent_type: string;
      provider: string;
      agent_name: string;
      model: string;
      model_version: string;
    };
  } | null;
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
  lease_id?: string;
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
  acceptance?: string;
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

export async function listWorkflows(
  repoPath?: string,
): Promise<BdResult<KnotWorkflowDefinition[]>> {
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

// ── Re-exports from knots-operations.ts ──────────────────────

export type {
  ClaimKnotOptions,
  NextKnotOptions,
  SetKnotProfileOptions,
  PollKnotOptions,
  CreateLeaseOptions,
} from "./knots-operations";

export {
  newKnot,
  claimKnot,
  skillPrompt,
  nextKnot,
  setKnotProfile,
  pollKnot,
  updateKnot,
  listEdges,
  addEdge,
  removeEdge,
  createLease,
  terminateLease,
  listLeases,
} from "./knots-operations";

// ── Internal exports for knots-operations.ts ─────────────────

/** @internal */
export {
  exec as _exec,
  execWrite as _execWrite,
  execWriteWithRetry as _execWriteWithRetry,
  withNextKnotSerialization as _withNextKnotSerialization,
  parseJson as _parseJson,
};

/** @internal Exposed for testing only. */
export function _pendingWriteCount(repoPath?: string): number {
  const key = resolveRepoPath(repoPath);
  return repoWriteQueues.get(key)?.pending ?? 0;
}

/** @internal Exposed for testing only. */
export function _pendingNextCount(knotId: string): number {
  return nextKnotQueues.get(knotId)?.pending ?? 0;
}
