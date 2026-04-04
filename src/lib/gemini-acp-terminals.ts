/**
 * Terminal management for Gemini ACP sessions.
 *
 * ACP delegates command execution to the client.
 * This module spawns and tracks child processes
 * on behalf of the Gemini agent.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

// ── Types ─────────────────────────────────────────

export interface ManagedTerminal {
  process: ChildProcess;
  output: string;
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
  exitWaiters: Array<() => void>;
}

export interface TerminalStore {
  terminals: Map<string, ManagedTerminal>;
  nextId: number;
  cwd: string;
}

// ── Constants ─────────────────────────────────────

const OUTPUT_BYTE_LIMIT = 100_000;

// ── Response helpers (shared with session) ────────

type Respond = (
  host: ChildProcess,
  id: unknown,
  result: Record<string, unknown>,
) => void;

type RespondError = (
  host: ChildProcess,
  id: unknown,
  code: number,
  message: string,
) => void;

// ── Terminal operations ───────────────────────────

export function handleTermCreate(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
  store: TerminalStore,
  respond: Respond,
): void {
  const command =
    typeof params.command === "string"
      ? params.command : "bash";
  const args = Array.isArray(params.args)
    ? params.args.map(String) : [];
  const cwd =
    typeof params.cwd === "string"
      ? params.cwd : store.cwd;

  const termId = `t${store.nextId++}`;
  const proc = spawn(command, args, {
    cwd,
    env: buildEnv(params.env),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const limit =
    typeof params.outputByteLimit === "number"
      ? params.outputByteLimit
      : OUTPUT_BYTE_LIMIT;

  const term: ManagedTerminal = {
    process: proc, output: "",
    exitCode: null, signal: null,
    exited: false, exitWaiters: [],
  };
  store.terminals.set(termId, term);

  const onData = (chunk: Buffer) => {
    if (term.output.length < limit) {
      term.output += chunk.toString();
    }
  };
  if (proc.stdout) proc.stdout.on("data", onData);
  if (proc.stderr) proc.stderr.on("data", onData);

  proc.on(
    "close",
    (code: number | null, sig: string | null) => {
      term.exitCode = code;
      term.signal = sig;
      term.exited = true;
      for (const w of term.exitWaiters) w();
      term.exitWaiters.length = 0;
    },
  );
  proc.on("error", () => {
    term.exited = true;
    term.exitCode = 1;
    for (const w of term.exitWaiters) w();
    term.exitWaiters.length = 0;
  });

  respond(host, id, { terminalId: termId });
}

function buildEnv(
  rawEnv: unknown,
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!Array.isArray(rawEnv)) return env;
  for (const raw of rawEnv) {
    const e = raw as Record<string, unknown>;
    if (
      typeof e?.name === "string" &&
      typeof e?.value === "string"
    ) {
      env[e.name] = e.value;
    }
  }
  return env;
}

function findTerminal(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
  store: TerminalStore,
  respondErr: RespondError,
): ManagedTerminal | null {
  const termId =
    typeof params.terminalId === "string"
      ? params.terminalId : "";
  const term = store.terminals.get(termId);
  if (!term) {
    respondErr(
      host, id, -1,
      `Terminal not found: ${termId}`,
    );
    return null;
  }
  return term;
}

export function handleTermOutput(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
  store: TerminalStore,
  respond: Respond,
  respondErr: RespondError,
): void {
  const term =
    findTerminal(host, id, params, store, respondErr);
  if (!term) return;
  respond(host, id, {
    output: term.output,
    truncated: false,
    ...(term.exited
      ? {
          exitStatus: {
            exitCode: term.exitCode,
            signal: term.signal,
          },
        }
      : {}),
  });
}

export function handleTermWait(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
  store: TerminalStore,
  respond: Respond,
  respondErr: RespondError,
): void {
  const term =
    findTerminal(host, id, params, store, respondErr);
  if (!term) return;
  const sendExit = () => respond(host, id, {
    exitStatus: {
      exitCode: term.exitCode,
      signal: term.signal,
    },
  });
  if (term.exited) {
    sendExit();
    return;
  }
  term.exitWaiters.push(sendExit);
}

export function handleTermKill(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
  store: TerminalStore,
  respond: Respond,
  respondErr: RespondError,
): void {
  const term =
    findTerminal(host, id, params, store, respondErr);
  if (!term) return;
  try {
    term.process.kill("SIGTERM");
  } catch { /* already dead */ }
  respond(host, id, {});
}

export function handleTermRelease(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
  store: TerminalStore,
  respond: Respond,
): void {
  const termId =
    typeof params.terminalId === "string"
      ? params.terminalId : "";
  const term = store.terminals.get(termId);
  if (term) {
    try {
      term.process.kill("SIGTERM");
    } catch { /* already dead */ }
    store.terminals.delete(termId);
  }
  respond(host, id, {});
}
