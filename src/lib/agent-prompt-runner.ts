import { spawn } from "node:child_process";
import {
  buildPromptModeArgs,
  createLineNormalizer,
  resolveDialect,
} from "@/lib/agent-adapter";
import type { AgentTarget } from "@/lib/types-agent-target";

export interface AgentPromptRunnerOptions {
  subsystem: string;
  subsystemLabel: string;
  timeoutMs: number;
  noOutputWarnMs: number;
  prompt: string;
  agent: AgentTarget;
  repoPath?: string;
}

interface PromptState {
  rawStdout: string;
  stderrText: string;
  ndjsonBuffer: string;
  assistantText: string;
  resultText: string;
}

interface SpawnContext {
  state: PromptState;
  spawnedAt: number;
  firstByteAt: { value: number | null };
  pid: number | string;
  subsystem: string;
  subsystemLabel: string;
  safeResolve: (value: string) => void;
  safeReject: (error: Error) => void;
  processLine: (line: string) => void;
}

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

function appendAssistantText(
  current: string,
  text: string,
): string {
  if (!text) return current;
  return current ? `${current}\n${text}` : text;
}

function handleParsedEvent(
  obj: Record<string, unknown>,
  state: PromptState,
  safeReject: (e: Error) => void,
): void {
  if (obj.type === "stream_event") {
    const event = toObject(obj.event);
    const delta = toObject(event?.delta);
    if (
      event?.type === "content_block_delta"
      && delta?.type === "text_delta"
      && typeof delta.text === "string"
    ) {
      state.assistantText += delta.text;
    }
    return;
  }
  if (obj.type === "assistant") {
    const msg = toObject(obj.message);
    const content = Array.isArray(msg?.content)
      ? msg.content
      : [];
    const text = content
      .map((block) => {
        const o = toObject(block);
        return o?.type === "text"
          && typeof o.text === "string"
          ? o.text
          : "";
      })
      .join("");
    state.assistantText = appendAssistantText(
      state.assistantText, text,
    );
    return;
  }
  if (obj.type === "result") {
    handleResultEvent(obj, state, safeReject);
  }
}

function handleResultEvent(
  obj: Record<string, unknown>,
  state: PromptState,
  safeReject: (e: Error) => void,
): void {
  if (obj.is_error === true) {
    const m =
      typeof obj.result === "string"
        ? obj.result
        : typeof obj.error === "string"
          ? obj.error
          : "agent result error";
    safeReject(new Error(m));
  } else if (typeof obj.result === "string") {
    state.resultText = obj.result;
  } else if (typeof obj.error === "string") {
    safeReject(
      new Error(`agent result error: ${obj.error}`),
    );
  }
}

function makeProcessLine(
  state: PromptState,
  normalizeEvent: (v: unknown) => unknown,
  safeReject: (e: Error) => void,
): (line: string) => void {
  return (line: string) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const obj = toObject(normalizeEvent(parsed));
    if (!obj || typeof obj.type !== "string") return;
    handleParsedEvent(obj, state, safeReject);
  };
}

function noteFirstByte(
  ctx: SpawnContext,
  source: "stdout" | "stderr",
): void {
  if (ctx.firstByteAt.value !== null) return;
  ctx.firstByteAt.value = Date.now();
  console.log(
    `[${ctx.subsystem}][spawn] first_byte `
      + `pid=${ctx.pid} source=${source} `
      + `dt=${ctx.firstByteAt.value - ctx.spawnedAt}ms`,
  );
}

function wireChildIo(
  child: ReturnType<typeof spawn>,
  ctx: SpawnContext,
): void {
  child.on("error", (e) => {
    console.warn(
      `[${ctx.subsystem}][spawn] error `
        + `pid=${ctx.pid} msg=${e.message}`,
    );
    ctx.safeReject(e);
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    noteFirstByte(ctx, "stdout");
    const text = chunk.toString();
    ctx.state.rawStdout += text;
    ctx.state.ndjsonBuffer += text;
    const lines = ctx.state.ndjsonBuffer.split("\n");
    ctx.state.ndjsonBuffer = lines.pop() ?? "";
    for (const line of lines) ctx.processLine(line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    noteFirstByte(ctx, "stderr");
    ctx.state.stderrText += chunk.toString();
  });
  child.on("close", (code) => handleClose(code, ctx));
}

function handleClose(
  code: number | null,
  ctx: SpawnContext,
): void {
  if (ctx.state.ndjsonBuffer.trim()) {
    ctx.processLine(ctx.state.ndjsonBuffer);
  }
  const elapsed = Date.now() - ctx.spawnedAt;
  console.log(
    `[${ctx.subsystem}][spawn] close `
      + `pid=${ctx.pid} code=${code ?? "null"} `
      + `elapsed_ms=${elapsed} `
      + `stdout_bytes=${ctx.state.rawStdout.length} `
      + `stderr_bytes=${ctx.state.stderrText.length}`,
  );
  if (code !== 0) {
    const detail = ctx.state.stderrText.trim()
      || `${ctx.subsystemLabel} agent exited with `
        + `code ${code ?? "unknown"}`;
    ctx.safeReject(new Error(detail));
    return;
  }
  ctx.safeResolve(
    ctx.state.resultText
      || ctx.state.assistantText
      || ctx.state.rawStdout,
  );
}

function startTimers(
  child: ReturnType<typeof spawn>,
  ctx: SpawnContext,
  timeoutMs: number,
  noOutputWarnMs: number,
): { timer: NodeJS.Timeout; noOutputTimer: NodeJS.Timeout } {
  const timer = setTimeout(() => {
    console.warn(
      `[${ctx.subsystem}][spawn] timeout `
        + `pid=${ctx.pid} `
        + `after=${timeoutMs / 1000}s `
        + `stdout_bytes=${ctx.state.rawStdout.length} `
        + `stderr_bytes=${ctx.state.stderrText.length} `
        + "sending SIGKILL",
    );
    child.kill("SIGKILL");
    ctx.safeReject(
      new Error(
        `${ctx.subsystemLabel} agent timed out after `
          + `${timeoutMs / 1000}s`,
      ),
    );
  }, timeoutMs);
  const noOutputTimer = setTimeout(() => {
    if (ctx.firstByteAt.value !== null) return;
    console.warn(
      `[${ctx.subsystem}][spawn] no_output `
        + `pid=${ctx.pid} `
        + `after=${noOutputWarnMs / 1000}s `
        + "(agent has produced no stdout/stderr; "
        + "subprocess may be hung — will SIGKILL at "
        + `${timeoutMs / 1000}s)`,
    );
  }, noOutputWarnMs);
  return { timer, noOutputTimer };
}

function spawnAndWire(
  built: { command: string; args: string[] },
  normalizeEvent: (v: unknown) => unknown,
  opts: AgentPromptRunnerOptions,
  resolve: (v: string) => void,
  reject: (e: Error) => void,
): void {
  let settled = false;
  const firstByteAt = { value: null as number | null };
  const spawnedAt = Date.now();
  const state: PromptState = {
    rawStdout: "",
    stderrText: "",
    ndjsonBuffer: "",
    assistantText: "",
    resultText: "",
  };

  const cwd = opts.repoPath?.trim() || process.cwd();
  const child = spawn(built.command, built.args, {
    cwd,
    env: process.env,
  });
  const pid = child.pid ?? "?";
  const cmdBase = built.command.split("/").pop()
    ?? built.command;
  console.log(
    `[${opts.subsystem}][spawn] cmd=${cmdBase} `
      + `pid=${pid} cwd=${cwd}`,
  );

  const ctx: SpawnContext = {
    state, spawnedAt, firstByteAt, pid,
    subsystem: opts.subsystem,
    subsystemLabel: opts.subsystemLabel,
    safeResolve: (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(noOutputTimer);
      resolve(value);
    },
    safeReject: (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(noOutputTimer);
      reject(error);
    },
    processLine: (l) => l,
  };
  ctx.processLine = makeProcessLine(
    state, normalizeEvent, ctx.safeReject,
  );
  const { timer, noOutputTimer } = startTimers(
    child, ctx, opts.timeoutMs, opts.noOutputWarnMs,
  );
  wireChildIo(child, ctx);
}

export function runAgentPrompt(
  opts: AgentPromptRunnerOptions,
): Promise<string> {
  const built = buildPromptModeArgs(opts.agent, opts.prompt);
  const dialect = resolveDialect(opts.agent.command);
  const normalizeEvent = createLineNormalizer(dialect);

  return new Promise<string>((resolve, reject) => {
    spawnAndWire(
      built, normalizeEvent, opts, resolve, reject,
    );
  });
}
