import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { applyPatch } from "diff";
import { join, resolve } from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import { StructuredExecutionBackend } from "@/lib/execution-backend";
import type {
  ExecutionAgentInfo,
  ExecutionLease,
  ExecutionSnapshot,
  PollLeaseResult,
} from "@/lib/execution-port";
import type { BackendResult } from "@/lib/backend-port";

const BLOCKED_SHELL_COMMANDS = new Set(["kno", "bd", "claude", "codex", "opencode"]);

export type LocalWorkerToolName =
  | "fs_read"
  | "fs_write_patch"
  | "fs_search"
  | "shell_exec"
  | "memory_show"
  | "memory_list_children"
  | "memory_list_dependencies"
  | "memory_add_note";

export interface WorkerToolCall {
  name: LocalWorkerToolName;
  input: Record<string, unknown>;
}

export interface WorkerToolResult {
  ok: boolean;
  content: string;
}

export interface WorkerSessionRequest {
  beatId: string;
  repoPath?: string;
  isParent: boolean;
  childBeatIds: string[];
  agentInfo?: ExecutionAgentInfo;
}

export interface WorkerSessionEvents {
  emitter: EventEmitter;
  abortSignal: AbortController;
}

export class LocalWorkerService {
  private executionBackend = new StructuredExecutionBackend();
  private sessions = new Map<string, WorkerSessionEvents>();

  createSession(sessionId: string): WorkerSessionEvents {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created = { emitter: new EventEmitter(), abortSignal: new AbortController() };
    this.sessions.set(sessionId, created);
    return created;
  }

  abortSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.abortSignal.abort();
    this.sessions.delete(sessionId);
  }

  completeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  async prepareTake(request: WorkerSessionRequest): Promise<BackendResult<ExecutionLease>> {
    return this.executionBackend.prepareTake({
      beatId: request.beatId,
      repoPath: request.repoPath,
      mode: request.isParent ? "scene" : "take",
      childBeatIds: request.childBeatIds,
      agentInfo: request.agentInfo,
    });
  }

  async preparePoll(
    repoPath?: string,
    agentInfo?: ExecutionAgentInfo,
  ): Promise<BackendResult<PollLeaseResult>> {
    return this.executionBackend.preparePoll({ repoPath, agentInfo });
  }

  async completeIteration(leaseId: string): Promise<BackendResult<ExecutionSnapshot>> {
    return this.executionBackend.completeIteration({ leaseId, outcome: "success" });
  }

  async rollbackIteration(leaseId: string, reason: string): Promise<BackendResult<void>> {
    return this.executionBackend.rollbackIteration({ leaseId, reason });
  }

  async getExecutionSnapshot(
    beatId: string,
    repoPath?: string,
  ): Promise<BackendResult<ExecutionSnapshot>> {
    return this.executionBackend.getExecutionSnapshot({ beatId, repoPath });
  }

  async runTool(
    call: WorkerToolCall,
    beatId: string,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    try {
      switch (call.name) {
        case "fs_read":
          return this.fsRead(call.input, repoPath);
        case "fs_search":
          return this.fsSearch(call.input, repoPath);
        case "fs_write_patch":
          return this.fsWritePatch(call.input, repoPath);
        case "shell_exec":
          return this.shellExec(call.input, repoPath);
        case "memory_show":
          return this.memoryShow(beatId, repoPath);
        case "memory_list_children":
          return this.memoryListChildren(beatId, repoPath);
        case "memory_list_dependencies":
          return this.memoryListDependencies(beatId, repoPath);
        case "memory_add_note":
          return this.memoryAddNote(beatId, call.input, repoPath);
        default:
          return { ok: false, content: `Unknown tool ${call.name}` };
      }
    } catch (error) {
      return { ok: false, content: error instanceof Error ? error.message : String(error) };
    }
  }

  private async fsRead(
    input: Record<string, unknown>,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const filePath = this.resolvePath(input.path, repoPath);
    const content = await readFile(filePath, "utf-8");
    return { ok: true, content };
  }

  private async fsSearch(
    input: Record<string, unknown>,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const root = this.resolvePath(input.path ?? ".", repoPath);
    const pattern = typeof input.pattern === "string" ? input.pattern : "";
    if (!pattern) return { ok: false, content: "pattern is required" };
    const matches: string[] = [];
    await this.walk(root, async (filePath) => {
      const content = await readFile(filePath, "utf-8").catch(() => "");
      if (content.includes(pattern)) {
        matches.push(filePath);
      }
    });
    return { ok: true, content: matches.join("\n") || "(no matches)" };
  }

  private async fsWritePatch(
    input: Record<string, unknown>,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const filePath = this.resolvePath(input.path, repoPath);
    const patch = typeof input.patch === "string" ? input.patch : "";
    if (!patch) return { ok: false, content: "patch is required" };
    const current = await readFile(filePath, "utf-8");
    const next = applyPatch(current, patch);
    if (next === false) {
      return { ok: false, content: "patch did not apply cleanly" };
    }
    await writeFile(filePath, next, "utf-8");
    return { ok: true, content: `patched ${filePath}` };
  }

  private async shellExec(
    input: Record<string, unknown>,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (!command) return { ok: false, content: "command is required" };
    const parts = command.split(/\s+/);
    if (parts.length === 0) return { ok: false, content: "command is required" };
    const [bin, ...args] = parts;
    if (BLOCKED_SHELL_COMMANDS.has(bin)) {
      return {
        ok: false,
        content: `shell_exec blocks ${bin}; use structured memory tools instead`,
      };
    }
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: repoPath ? resolve(repoPath) : process.cwd(),
      env: { ...process.env },
    });
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return { ok: true, content: output || "(no output)" };
  }

  private async memoryShow(
    beatId: string,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const result = await this.executionBackend.getExecutionSnapshot(
      { beatId, repoPath },
    );
    if (!result.ok || !result.data) {
      return { ok: false, content: result.error?.message ?? "not found" };
    }
    return { ok: true, content: JSON.stringify(result.data.beat, null, 2) };
  }

  private async memoryListChildren(
    beatId: string,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const result = await this.executionBackend.getExecutionSnapshot(
      { beatId, repoPath },
    );
    if (!result.ok || !result.data) {
      return { ok: false, content: result.error?.message ?? "not found" };
    }
    return {
      ok: true,
      content: JSON.stringify(result.data.children, null, 2),
    };
  }

  private async memoryListDependencies(
    beatId: string,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const result = await this.executionBackend.getExecutionSnapshot(
      { beatId, repoPath },
    );
    if (!result.ok || !result.data) {
      return { ok: false, content: result.error?.message ?? "not found" };
    }
    return {
      ok: true,
      content: JSON.stringify(result.data.dependencies, null, 2),
    };
  }

  private async memoryAddNote(
    beatId: string,
    input: Record<string, unknown>,
    repoPath?: string,
  ): Promise<WorkerToolResult> {
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (!note) return { ok: false, content: "note is required" };
    const backend = new StructuredExecutionBackend();
    const snapshot = await backend.getExecutionSnapshot({ beatId, repoPath });
    if (!snapshot.ok || !snapshot.data) {
      return { ok: false, content: snapshot.error?.message ?? "not found" };
    }
    const isKnotsBacked =
      resolve(repoPath ?? process.cwd()).includes(".knots") ||
      snapshot.data.beat.type === "work";
    if (isKnotsBacked) {
      const { updateKnot } = await import("@/lib/knots");
      const updated = await updateKnot(beatId, { addNote: note }, repoPath);
      return {
        ok: updated.ok,
        content: updated.ok ? "note added" : updated.error ?? "failed",
      };
    }
    return { ok: false, content: "memory_add_note is only implemented for knots-backed beats" };
  }

  private resolvePath(rawPath: unknown, repoPath?: string): string {
    if (typeof rawPath !== "string" || !rawPath.trim()) {
      throw new Error("path is required");
    }
    if (rawPath.startsWith("/")) return rawPath;
    return resolve(repoPath ?? process.cwd(), rawPath);
  }

  private async walk(root: string, visit: (path: string) => Promise<void>): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const filePath = join(root, entry.name);
      if (entry.isDirectory()) {
        await this.walk(filePath, visit);
      } else if (entry.isFile()) {
        await visit(filePath);
      }
    }
  }
}
