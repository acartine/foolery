import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { showBead } from "@/lib/bd";
import type { TerminalSession, TerminalEvent, TerminalSessionStatus } from "@/lib/types";

interface SessionEntry {
  session: TerminalSession;
  process: ChildProcess | null;
  emitter: EventEmitter;
  buffer: TerminalEvent[];
}

const MAX_BUFFER = 5000;
const MAX_SESSIONS = 4;
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

const sessions = new Map<string, SessionEntry>();

function generateId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getSession(id: string): SessionEntry | undefined {
  return sessions.get(id);
}

export function listSessions(): TerminalSession[] {
  return Array.from(sessions.values()).map((e) => e.session);
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

  const id = generateId();
  const prompt =
    customPrompt ??
    `Implement the following bead:\n\nID: ${bead.id}\nTitle: ${bead.title}\nType: ${bead.type}\nPriority: P${bead.priority}\n${bead.description ? `\nDescription:\n${bead.description}` : ""}${bead.acceptance ? `\nAcceptance Criteria:\n${bead.acceptance}` : ""}${bead.notes ? `\nNotes:\n${bead.notes}` : ""}`;

  const session: TerminalSession = {
    id,
    beadId: bead.id,
    beadTitle: bead.title,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  const buffer: TerminalEvent[] = [];

  const entry: SessionEntry = { session, process: null, emitter, buffer };
  sessions.set(id, entry);

  // Spawn claude CLI
  const args = ["-p", prompt, "--output-format", "text"];
  const cwd = repoPath || process.cwd();
  const child = spawn("claude", args, {
    cwd,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  entry.process = child;

  const pushEvent = (evt: TerminalEvent) => {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(evt);
    emitter.emit("data", evt);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    pushEvent({ type: "stdout", data: chunk.toString(), timestamp: Date.now() });
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    pushEvent({ type: "stderr", data: chunk.toString(), timestamp: Date.now() });
  });

  child.on("close", (code) => {
    session.exitCode = code ?? 1;
    session.status = code === 0 ? "completed" : "error";
    pushEvent({
      type: "exit",
      data: String(code ?? 1),
      timestamp: Date.now(),
    });
    entry.process = null;

    // Schedule cleanup
    setTimeout(() => {
      sessions.delete(id);
    }, CLEANUP_DELAY_MS);
  });

  child.on("error", (err) => {
    session.status = "error";
    pushEvent({
      type: "stderr",
      data: `Process error: ${err.message}`,
      timestamp: Date.now(),
    });
    pushEvent({ type: "exit", data: "1", timestamp: Date.now() });
    entry.process = null;

    setTimeout(() => {
      sessions.delete(id);
    }, CLEANUP_DELAY_MS);
  });

  return session;
}

export function abortSession(id: string): boolean {
  const entry = sessions.get(id);
  if (!entry || !entry.process) return false;

  entry.session.status = "aborted";
  entry.process.kill("SIGTERM");

  // Force kill after 5s if still alive
  setTimeout(() => {
    if (entry.process && !entry.process.killed) {
      entry.process.kill("SIGKILL");
    }
  }, 5000);

  return true;
}
