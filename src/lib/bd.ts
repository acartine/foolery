import { execFile } from "node:child_process";
import type { Bead, BeadDependency, BdResult } from "./types";

const BD_BIN = process.env.BD_BIN ?? "bd";
const BD_DB = process.env.BD_DB;

function baseArgs(): string[] {
  const args: string[] = [];
  if (BD_DB) args.push("--db", BD_DB);
  return args;
}

async function exec(
  args: string[],
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(BD_BIN, [...baseArgs(), ...args], { env: process.env, cwd: options?.cwd }, (error, stdout, stderr) => {
      resolve({
        stdout: (stdout ?? "").trim(),
        stderr: (stderr ?? "").trim(),
        exitCode: error ? (error.code as number) ?? 1 : 0,
      });
    });
  });
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/** Map bd CLI JSON field names to our Bead interface field names. */
function normalizeBead(raw: Record<string, unknown>): Bead {
  return {
    ...raw,
    type: (raw.issue_type ?? raw.type ?? "task") as Bead["type"],
    status: (raw.status ?? "open") as Bead["status"],
    priority: (raw.priority ?? 2) as Bead["priority"],
    created: (raw.created_at ?? raw.created) as string,
    updated: (raw.updated_at ?? raw.updated) as string,
    estimate: (raw.estimated_minutes ?? raw.estimate) as number | undefined,
    labels: (raw.labels ?? []) as string[],
  } as Bead;
}

function normalizeBeads(raw: string): Bead[] {
  const items = JSON.parse(raw) as Record<string, unknown>[];
  return items.map(normalizeBead);
}

export async function listBeads(
  filters?: Record<string, string>,
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["list", "--json", "--limit", "0"];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (val) args.push(`--${key}`, val);
    }
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd list failed" };
  try {
    return { ok: true, data: normalizeBeads(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd list output" };
  }
}

export async function readyBeads(
  filters?: Record<string, string>,
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["ready", "--json", "--limit", "0"];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (val) args.push(`--${key}`, val);
    }
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd ready failed" };
  try {
    return { ok: true, data: normalizeBeads(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd ready output" };
  }
}

export async function queryBeads(
  expression: string,
  options?: { limit?: number; sort?: string },
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["query", expression, "--json"];
  if (options?.limit) args.push("--limit", String(options.limit));
  if (options?.sort) args.push("--sort", options.sort);
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd query failed" };
  try {
    return { ok: true, data: normalizeBeads(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd query output" };
  }
}

export async function showBead(id: string, repoPath?: string): Promise<BdResult<Bead>> {
  const { stdout, stderr, exitCode } = await exec(["show", id, "--json"], { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd show failed" };
  try {
    const parsed = JSON.parse(stdout);
    const item = Array.isArray(parsed) ? parsed[0] : parsed;
    return { ok: true, data: normalizeBead(item as Record<string, unknown>) };
  } catch {
    return { ok: false, error: "Failed to parse bd show output" };
  }
}

export async function createBead(
  fields: Record<string, string | string[] | number | undefined>,
  repoPath?: string
): Promise<BdResult<{ id: string }>> {
  const args = ["create", "--json"];
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined || val === "") continue;
    if (key === "labels" && Array.isArray(val)) {
      args.push("--labels", val.join(","));
    } else {
      args.push(`--${key}`, String(val));
    }
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd create failed" };
  try {
    return { ok: true, data: parseJson<{ id: string }>(stdout) };
  } catch {
    // bd create may output just the ID
    const id = stdout.trim();
    if (id) return { ok: true, data: { id } };
    return { ok: false, error: "Failed to parse bd create output" };
  }
}

export async function updateBead(
  id: string,
  fields: Record<string, string | string[] | number | undefined>,
  repoPath?: string
): Promise<BdResult<void>> {
  const args = ["update", id];
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    if (key === "labels" && Array.isArray(val)) {
      args.push("--set-labels", val.join(","));
    } else {
      args.push(`--${key}`, String(val));
    }
  }
  const { stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd update failed" };
  return { ok: true };
}

export async function deleteBead(id: string, repoPath?: string): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec(["delete", id, "--force"], { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd delete failed" };
  return { ok: true };
}

export async function closeBead(
  id: string,
  reason?: string,
  repoPath?: string
): Promise<BdResult<void>> {
  const args = ["close", id];
  if (reason) args.push("--reason", reason);
  const { stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd close failed" };
  return { ok: true };
}

export async function listDeps(id: string, repoPath?: string): Promise<BdResult<BeadDependency[]>> {
  const { stdout, stderr, exitCode } = await exec([
    "dep",
    "list",
    id,
    "--json",
  ], { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd dep list failed" };
  try {
    return { ok: true, data: parseJson<BeadDependency[]>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd dep list output" };
  }
}

export async function addDep(
  blockerId: string,
  blockedId: string,
  repoPath?: string
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec([
    "dep",
    blockerId,
    "--blocks",
    blockedId,
  ], { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd dep add failed" };
  return { ok: true };
}
