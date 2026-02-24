import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import type { BdResult } from "./types";

const KNOTS_BIN = process.env.KNOTS_BIN ?? "knots";
const KNOTS_DB_PATH = process.env.KNOTS_DB_PATH;
const COMMAND_TIMEOUT_MS = envInt("FOOLERY_KNOTS_COMMAND_TIMEOUT_MS", 5000);

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
  updated_at: string;
  body?: string | null;
  description?: string | null;
  priority?: number | null;
  type?: string | null;
  tags?: string[];
  notes?: Array<Record<string, unknown>>;
  handoff_capsules?: Array<Record<string, unknown>>;
  workflow_etag?: string | null;
  created_at?: string | null;
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

        resolveExec({
          stdout: (stdout ?? "").trim(),
          stderr: stderrText,
          exitCode,
        });
      },
    );
  });
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export async function listKnots(repoPath?: string): Promise<BdResult<KnotRecord[]>> {
  const { stdout, stderr, exitCode } = await exec(["ls", "--json"], { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots ls failed" };
  try {
    return { ok: true, data: parseJson<KnotRecord[]>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse knots ls output" };
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
  options?: { body?: string; state?: string },
  repoPath?: string,
): Promise<BdResult<{ id: string }>> {
  const args = ["new"];
  if (options?.body) args.push("--body", options.body);
  if (options?.state) args.push("--state", options.state);
  args.push("--", title);

  const { stdout, stderr, exitCode } = await exec(args, { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots new failed" };

  const match = /^created\s+(\S+)\s+\[/m.exec(stdout);
  if (!match?.[1]) {
    return { ok: false, error: "Failed to parse knots new output" };
  }

  return { ok: true, data: { id: match[1] } };
}

export async function updateKnot(
  id: string,
  input: KnotUpdateInput,
  repoPath?: string,
): Promise<BdResult<void>> {
  const args = ["update", id];

  if (input.title !== undefined) args.push("--title", input.title);
  if (input.description !== undefined) args.push("--description", input.description);
  if (input.priority !== undefined) args.push("--priority", String(input.priority));
  if (input.status !== undefined) args.push("--status", input.status);
  if (input.type !== undefined) args.push("--type", input.type);

  for (const tag of input.addTags ?? []) {
    if (tag.trim()) args.push("--add-tag", tag);
  }
  for (const tag of input.removeTags ?? []) {
    if (tag.trim()) args.push("--remove-tag", tag);
  }

  if (input.addNote !== undefined) {
    args.push("--add-note", input.addNote);
    if (input.noteUsername) args.push("--note-username", input.noteUsername);
    if (input.noteDatetime) args.push("--note-datetime", input.noteDatetime);
    if (input.noteAgentname) args.push("--note-agentname", input.noteAgentname);
    if (input.noteModel) args.push("--note-model", input.noteModel);
    if (input.noteVersion) args.push("--note-version", input.noteVersion);
  }

  if (input.addHandoffCapsule !== undefined) {
    args.push("--add-handoff-capsule", input.addHandoffCapsule);
    if (input.handoffUsername) args.push("--handoff-username", input.handoffUsername);
    if (input.handoffDatetime) args.push("--handoff-datetime", input.handoffDatetime);
    if (input.handoffAgentname) args.push("--handoff-agentname", input.handoffAgentname);
    if (input.handoffModel) args.push("--handoff-model", input.handoffModel);
    if (input.handoffVersion) args.push("--handoff-version", input.handoffVersion);
  }

  if (input.force) args.push("--force");

  const { stderr, exitCode } = await exec(args, { repoPath });
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
  const { stderr, exitCode } = await exec(["edge", "add", src, kind, dst], { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots edge add failed" };
  return { ok: true };
}

export async function removeEdge(
  src: string,
  kind: string,
  dst: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec(["edge", "remove", src, kind, dst], { repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "knots edge remove failed" };
  return { ok: true };
}
