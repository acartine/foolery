import type { Bead, BeadDependency, BdResult } from "./types";

const BD_BIN = process.env.BD_BIN ?? "bd";
const BD_DB = process.env.BD_DB;

function baseArgs(): string[] {
  const args: string[] = [];
  if (BD_DB) args.push("--db", BD_DB);
  return args;
}

async function exec(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([BD_BIN, ...baseArgs(), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export async function listBeads(
  filters?: Record<string, string>
): Promise<BdResult<Bead[]>> {
  const args = ["list", "--json", "--limit", "0"];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (val) args.push(`--${key}`, val);
    }
  }
  const { stdout, stderr, exitCode } = await exec(args);
  if (exitCode !== 0) return { ok: false, error: stderr || "bd list failed" };
  try {
    return { ok: true, data: parseJson<Bead[]>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd list output" };
  }
}

export async function readyBeads(
  filters?: Record<string, string>
): Promise<BdResult<Bead[]>> {
  const args = ["ready", "--json", "--limit", "0"];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (val) args.push(`--${key}`, val);
    }
  }
  const { stdout, stderr, exitCode } = await exec(args);
  if (exitCode !== 0) return { ok: false, error: stderr || "bd ready failed" };
  try {
    return { ok: true, data: parseJson<Bead[]>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd ready output" };
  }
}

export async function queryBeads(
  expression: string,
  options?: { limit?: number; sort?: string }
): Promise<BdResult<Bead[]>> {
  const args = ["query", expression, "--json"];
  if (options?.limit) args.push("--limit", String(options.limit));
  if (options?.sort) args.push("--sort", options.sort);
  const { stdout, stderr, exitCode } = await exec(args);
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd query failed" };
  try {
    return { ok: true, data: parseJson<Bead[]>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd query output" };
  }
}

export async function showBead(id: string): Promise<BdResult<Bead>> {
  const { stdout, stderr, exitCode } = await exec(["show", id, "--json"]);
  if (exitCode !== 0) return { ok: false, error: stderr || "bd show failed" };
  try {
    return { ok: true, data: parseJson<Bead>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd show output" };
  }
}

export async function createBead(
  fields: Record<string, string | string[] | number | undefined>
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
  const { stdout, stderr, exitCode } = await exec(args);
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
  fields: Record<string, string | string[] | number | undefined>
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
  const { stderr, exitCode } = await exec(args);
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd update failed" };
  return { ok: true };
}

export async function deleteBead(id: string): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec(["delete", id, "--force"]);
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd delete failed" };
  return { ok: true };
}

export async function closeBead(
  id: string,
  reason?: string
): Promise<BdResult<void>> {
  const args = ["close", id];
  if (reason) args.push("--reason", reason);
  const { stderr, exitCode } = await exec(args);
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd close failed" };
  return { ok: true };
}

export async function listDeps(id: string): Promise<BdResult<BeadDependency[]>> {
  const { stdout, stderr, exitCode } = await exec([
    "dep",
    "list",
    id,
    "--json",
  ]);
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
  blockedId: string
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec([
    "dep",
    blockerId,
    "--blocks",
    blockedId,
  ]);
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd dep add failed" };
  return { ok: true };
}
