/**
 * Locks in the enriched child-close diagnostics
 * (foolery-e750). Covers:
 *   1. lastStdoutAt updates on each stdout chunk in
 *      doWireStdout.
 *   2. captureChildCloseDiagnostics reads exitReason,
 *      msSinceLastStdout, lastEventType from runtime
 *      state and falls back to "normal" when
 *      exitReason is null.
 *   3. formatDiagnosticsForLog emits the exact tokens
 *      (`signal=`, `msSinceLastStdout=`, etc.) that
 *      human operators grep for — prevents silent
 *      regressions in the log format.
 */
import {
  describe, it, expect, vi,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createSessionRuntime,
  type SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  captureChildCloseDiagnostics,
  formatDiagnosticsForLog,
} from "@/lib/agent-session-close-diagnostics";

function makeInteractionLog() {
  return {
    logStdout: vi.fn(),
    logStderr: vi.fn(),
    logResponse: vi.fn(),
    logPrompt: vi.fn(),
    logEnd: vi.fn(),
    logBeatState: vi.fn(),
    filePath: null,
  } as unknown as
    import("@/lib/interaction-logger").InteractionLog;
}

function makeChild(): ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return {
    stdout,
    stderr,
    stdin: new PassThrough(),
    pid: 7777,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeConfig(): SessionRuntimeConfig {
  return {
    id: "test-close-diag",
    dialect: "claude",
    capabilities: resolveCapabilities("claude"),
    watchdogTimeoutMs: null,
    normalizeEvent: createLineNormalizer("claude"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
  };
}

describe("lastStdoutAt: updated on every chunk", () => {
  it("is null before any stdout", () => {
    const rt = createSessionRuntime(makeConfig());
    expect(rt.state.lastStdoutAt).toBeNull();
  });

  it(
    "is set to Date.now() after first stdout chunk",
    async () => {
      const rt = createSessionRuntime(makeConfig());
      const child = makeChild();
      rt.wireStdout(child);
      const before = Date.now();
      (child.stdout as PassThrough).write(
        "hello\n",
      );
      await new Promise((r) => setImmediate(r));
      const after = Date.now();
      expect(
        typeof rt.state.lastStdoutAt,
      ).toBe("number");
      expect(rt.state.lastStdoutAt!).toBeGreaterThanOrEqual(before);
      expect(rt.state.lastStdoutAt!).toBeLessThanOrEqual(after);
    },
  );

  it(
    "advances on subsequent chunks",
    async () => {
      const rt = createSessionRuntime(makeConfig());
      const child = makeChild();
      rt.wireStdout(child);
      (child.stdout as PassThrough).write("a\n");
      await new Promise((r) => setImmediate(r));
      const first = rt.state.lastStdoutAt!;
      await new Promise((r) => setTimeout(r, 5));
      (child.stdout as PassThrough).write("b\n");
      await new Promise((r) => setImmediate(r));
      expect(
        rt.state.lastStdoutAt!,
      ).toBeGreaterThanOrEqual(first);
    },
  );
});

describe("captureChildCloseDiagnostics", () => {
  it(
    "falls back to exitReason=normal when null",
    () => {
      const rt = createSessionRuntime(makeConfig());
      const diag = captureChildCloseDiagnostics(
        rt.state,
      );
      expect(diag.exitReason).toBe("normal");
      expect(diag.msSinceLastStdout).toBeNull();
      expect(diag.lastEventType).toBeNull();
    },
  );

  it(
    "reports exitReason, msSinceLastStdout, and lastEventType",
    () => {
      const rt = createSessionRuntime(makeConfig());
      rt.state.exitReason = "timeout";
      rt.state.lastStdoutAt = Date.now() - 500;
      rt.state.lastNormalizedEvent = {
        type: "result",
        is_error: false,
      };
      const diag = captureChildCloseDiagnostics(
        rt.state,
        rt.state.lastStdoutAt + 500,
      );
      expect(diag.exitReason).toBe("timeout");
      expect(diag.msSinceLastStdout).toBe(500);
      expect(diag.lastEventType).toBe("result");
    },
  );

  it(
    "handles lastNormalizedEvent without string type",
    () => {
      const rt = createSessionRuntime(makeConfig());
      rt.state.lastNormalizedEvent = { type: 42 };
      const diag = captureChildCloseDiagnostics(
        rt.state,
      );
      expect(diag.lastEventType).toBeNull();
    },
  );

  it(
    "is safe when state is null",
    () => {
      const diag = captureChildCloseDiagnostics(
        null,
      );
      expect(diag.exitReason).toBe("normal");
      expect(diag.msSinceLastStdout).toBeNull();
      expect(diag.lastEventType).toBeNull();
    },
  );
});

describe("formatDiagnosticsForLog: log format lock", () => {
  it(
    "includes signal=, exitReason=, msSinceLastStdout=, lastEventType=",
    () => {
      const line = formatDiagnosticsForLog(
        {
          exitReason: "timeout",
          msSinceLastStdout: 1234,
          lastEventType: "assistant",
        },
        "SIGTERM",
      );
      expect(line).toContain(" signal=SIGTERM");
      expect(line).toContain(" exitReason=timeout");
      expect(line).toContain(
        " msSinceLastStdout=1234",
      );
      expect(line).toContain(
        " lastEventType=assistant",
      );
    },
  );

  it(
    "prints signal=null and msSinceLastStdout=null cleanly",
    () => {
      const line = formatDiagnosticsForLog(
        {
          exitReason: "normal",
          msSinceLastStdout: null,
          lastEventType: null,
        },
        null,
      );
      expect(line).toContain(" signal=null");
      expect(line).toContain(" exitReason=normal");
      expect(line).toContain(
        " msSinceLastStdout=null",
      );
      expect(line).toContain(" lastEventType=null");
    },
  );
});
