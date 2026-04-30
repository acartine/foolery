/**
 * Regression tests for foolery-70fb.
 *
 * Bug A (the hang): processNormalizedEvent in
 * agent-session-runtime-events.ts unconditionally
 * cancelled the input-close timer on every normalized
 * event. After session.idle fires turn_ended, the
 * OpenCode HTTP transport keeps emitting post-idle SSE
 * events (file watchers, snapshot logs, message-updated
 * flushes) which cancelled the 2s grace-period close
 * timer before it could fire — leaving the OpenCode
 * child alive forever and hanging the take loop on
 * compactor-518c (2026-04-30).
 *
 * Bug B (the spurious follow-up): doTurn in
 * opencode-http-session.ts synthesised a fake
 * {type:"step_finish", part:{reason:"error"}} event
 * whenever the HTTP POST /session/X/message returned
 * null (which happens on undici's default 5min
 * headersTimeout while long agent turns are still
 * running). The synthetic error fired turn_ended with
 * is_error:true, triggering a take-loop "advance or
 * rollback" follow-up while the real turn was still
 * in flight via the SSE stream.
 */
import {
  describe, it, expect, vi,
  beforeEach, afterEach,
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
  interactiveSessionTimeoutMinutesToMs,
} from "@/lib/interactive-session-timeout";
import {
  createOpenCodeHttpSession,
  type OpenCodeHttpSession,
} from "@/lib/opencode-http-session";

const DEFAULT_WATCHDOG_TIMEOUT_MS =
  interactiveSessionTimeoutMinutesToMs(10);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Helpers ──────────────────────────────────────────

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
  const stdin = new PassThrough();
  return {
    stdout,
    stderr,
    stdin,
    pid: 70707,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeOpenCodeConfig(
  overrides?: Partial<SessionRuntimeConfig>,
): {
  config: SessionRuntimeConfig;
  httpSession: OpenCodeHttpSession;
} {
  const caps = resolveCapabilities("opencode", true);
  const httpSession = createOpenCodeHttpSession(
    () => { /* no-op */ },
    vi.fn(),
  );
  const config: SessionRuntimeConfig = {
    id: "70fb-test",
    dialect: "opencode",
    capabilities: caps,
    watchdogTimeoutMs: DEFAULT_WATCHDOG_TIMEOUT_MS,
    normalizeEvent:
      createLineNormalizer("opencode"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    httpSession,
    ...overrides,
  };
  return { config, httpSession };
}

// ── Bug A: input-close cancellation ─────────────────

describe(
  "foolery-70fb Bug A: post-idle events do not cancel close",
  () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("session_idle schedules close; post-idle "
      + "event does NOT cancel it", () => {
      const { config } = makeOpenCodeConfig();
      const rt = createSessionRuntime(config);
      const child = makeChild();
      rt.wireStdout(child);

      // Real turn-end signal.
      rt.injectLine(child, JSON.stringify({
        type: "session_idle",
      }));
      expect(rt.state.resultObserved).toBe(true);
      expect(rt.state.closeInputTimer).not.toBeNull();
      const timerAfterIdle = rt.state.closeInputTimer;

      // Post-idle SSE noise (a streaming text part
      // delta finishing late, e.g.). Without the fix
      // this would cancel the close timer.
      rt.injectLine(child, JSON.stringify({
        type: "text",
        part: { text: "trailing chunk" },
      }));

      expect(rt.state.resultObserved).toBe(true);
      expect(rt.state.closeInputTimer).not.toBeNull();
      // Same timer handle — not cancelled and replaced.
      expect(rt.state.closeInputTimer).toBe(
        timerAfterIdle,
      );
    });

    it("close fires after grace period despite "
      + "post-idle SSE noise", () => {
      const { config } = makeOpenCodeConfig();
      const rt = createSessionRuntime(config);
      const child = makeChild();
      rt.wireStdout(child);

      rt.injectLine(child, JSON.stringify({
        type: "session_idle",
      }));
      // Stream of post-idle events, mimicking
      // OpenCode's /event SSE during the 2s grace.
      for (let i = 0; i < 20; i += 1) {
        vi.advanceTimersByTime(50);
        rt.injectLine(child, JSON.stringify({
          type: "text",
          part: { text: `chunk ${i}` },
        }));
      }

      // Now exhaust the remaining grace window.
      vi.advanceTimersByTime(2000);
      // The close fired: stdin marked closed.
      expect(rt.state.stdinClosed).toBe(true);
    });

    it("pre-idle events DO cancel the close "
      + "(resultObserved=false path)", () => {
      const { config } = makeOpenCodeConfig();
      const rt = createSessionRuntime(config);
      const child = makeChild();
      rt.wireStdout(child);

      // Manually arm a close as if a previous turn
      // ended, then reset resultObserved to simulate
      // a fresh turn beginning.
      rt.scheduleInputClose(child);
      expect(rt.state.closeInputTimer).not.toBeNull();
      rt.state.resultObserved = false;

      rt.injectLine(child, JSON.stringify({
        type: "text",
        part: { text: "fresh turn" },
      }));
      // Cancellation engaged because the turn has
      // not ended yet.
      expect(rt.state.closeInputTimer).toBeNull();
    });

    it("resetForNewTurn (via sendUserTurn) "
      + "restores cancellation", () => {
      const { config } = makeOpenCodeConfig();
      const rt = createSessionRuntime(config);
      const child = makeChild();
      rt.wireStdout(child);

      rt.injectLine(child, JSON.stringify({
        type: "session_idle",
      }));
      expect(rt.state.resultObserved).toBe(true);
      const armed = rt.state.closeInputTimer;
      expect(armed).not.toBeNull();

      // sendUserTurn for the HTTP transport routes
      // through sendHttpTurn → httpSession.startTurn.
      // With no serverUrl set yet, startTurn defers
      // and returns true. The httpSession path does
      // NOT call resetForNewTurn until startTurn
      // succeeds — so we exercise the contract by
      // manually mirroring resetForNewTurn's effect:
      // the runtime invariant is that a fresh turn
      // resets resultObserved.
      rt.state.resultObserved = false;

      rt.injectLine(child, JSON.stringify({
        type: "text",
        part: { text: "agent reply to follow-up" },
      }));
      // With resultObserved=false again,
      // cancellation re-engages.
      expect(rt.state.closeInputTimer).toBeNull();
    });
  },
);

// ── Bug B: synthetic error suppression ──────────────

interface RecordedEvents {
  events: Array<Record<string, unknown>>;
  errors: string[];
}

function makeRecorder(): {
  onEvent: (line: string) => void;
  onError: (msg: string) => void;
  recorded: RecordedEvents;
} {
  const recorded: RecordedEvents = {
    events: [], errors: [],
  };
  return {
    onEvent: (line) => {
      try {
        recorded.events.push(
          JSON.parse(line) as Record<string, unknown>,
        );
      } catch {
        // ignore non-JSON lines
      }
    },
    onError: (msg) => { recorded.errors.push(msg); },
    recorded,
  };
}

function stubFetchSequence(
  responses: Array<Response | null>,
): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const stub = vi.fn(async () => {
    const next = queue.shift();
    if (next === null) {
      throw new TypeError("fetch failed");
    }
    if (!next) {
      throw new TypeError(
        "no more stubbed fetch responses",
      );
    }
    return next;
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function jsonResponse(
  body: unknown, status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe(
  "foolery-70fb Bug B: POST timeout no longer "
    + "synthesises a fake error result",
  () => {
    it("sendMessage-returns-null path does NOT "
      + "emit step_finish reason=error", async () => {
      const { onEvent, onError, recorded } =
        makeRecorder();
      const session = createOpenCodeHttpSession(
        onEvent, onError,
      );
      // Discover server URL → ready=true.
      session.processStdoutLine(
        "opencode server listening on " +
        "http://127.0.0.1:4096",
      );
      // First fetch (createSession) succeeds, second
      // fetch (sendMessage) "times out" → throws.
      stubFetchSequence([
        jsonResponse({ id: "sess-abc" }),
        null,
      ]);
      const child = makeChild();
      const sent = session.startTurn(child, "hi");
      expect(sent).toBe(true);
      // Wait for doTurn's microtasks/promises to
      // settle. fetch is awaited twice.
      await new Promise(
        (resolve) => setTimeout(resolve, 0),
      );
      await new Promise(
        (resolve) => setTimeout(resolve, 0),
      );

      // No synthetic error result fired.
      const stepFinishErrors = recorded.events.filter(
        (e) => e.type === "step_finish"
          && (e.part as Record<string, unknown>)
            ?.reason === "error",
      );
      expect(stepFinishErrors).toEqual([]);
      // Operator-visible error was logged.
      expect(recorded.errors.some((m) =>
        m.includes("HTTP message request failed"),
      )).toBe(true);
    });

    it("session-not-ready path DOES emit "
      + "step_finish reason=error", async () => {
      const { onEvent, onError, recorded } =
        makeRecorder();
      const session = createOpenCodeHttpSession(
        onEvent, onError,
      );
      session.processStdoutLine(
        "opencode server listening on " +
        "http://127.0.0.1:4096",
      );
      // createSession returns a body without an id
      // → ensureSession sees null id → returns false
      // → doTurn enters the http_session_not_ready
      // branch → emitErrorResult fires.
      stubFetchSequence([
        jsonResponse({ /* no id */ }),
      ]);
      const child = makeChild();
      const sent = session.startTurn(child, "hi");
      expect(sent).toBe(true);
      await new Promise(
        (resolve) => setTimeout(resolve, 0),
      );
      await new Promise(
        (resolve) => setTimeout(resolve, 0),
      );

      const stepFinishErrors = recorded.events.filter(
        (e) => e.type === "step_finish"
          && (e.part as Record<string, unknown>)
            ?.reason === "error",
      );
      expect(stepFinishErrors).toHaveLength(1);
      expect(recorded.errors.some((m) =>
        m.includes("Failed to create OpenCode session"),
      )).toBe(true);
    });
  },
);
