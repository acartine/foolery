import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { resolveServerLogDir } from "@/lib/server-logger";

/**
 * Tap all console.log / console.warn / console.error output to a daily
 * log file alongside the interaction logs.
 *
 * File: {logRoot}/_server/{YYYY-MM-DD}/console.log
 *
 * Call once at process startup (instrumentation.ts).  Idempotent —
 * repeat calls are no-ops.
 */

let installed = false;
let currentDate = "";
let stream: WriteStream | null = null;
let restoreConsole: (() => void) | null = null;
let uncaughtExceptionMonitorHandler:
  | ((error: Error | unknown) => void)
  | null = null;
let unhandledRejectionHandler:
  | ((reason: unknown, promise: Promise<unknown>) => void)
  | null = null;

// Exported for testing — allows injecting a custom date function.
export let _dateNow: () => Date = () => new Date();
let _rethrowUnhandledRejection: (reason: unknown) => void = (reason) => {
  queueMicrotask(() => {
    throw reason;
  });
};
export function _setDateNow(fn: () => Date): void {
  _dateNow = fn;
}

export function _setUnhandledRejectionRethrow(
  fn: ((reason: unknown) => void) | null,
): void {
  _rethrowUnhandledRejection =
    fn ??
    ((reason) => {
      queueMicrotask(() => {
        throw reason;
      });
    });
}

function closeStream(): void {
  if (!stream) return;
  stream.end();
  stream = null;
  currentDate = "";
}

type TrackableReason = object | ((...args: unknown[]) => unknown);

function isTrackableReason(
  reason: unknown,
): reason is TrackableReason {
  return (
    (typeof reason === "object" && reason !== null) || typeof reason === "function"
  );
}

const forwardedReasons = new WeakSet<TrackableReason>();
const forwardedPrimitiveReasons = new Set<string>();

function markForwardedReason(reason: unknown): void {
  if (isTrackableReason(reason)) {
    forwardedReasons.add(reason);
    return;
  }
  forwardedPrimitiveReasons.add(String(reason));
}

function clearForwardedReason(reason: unknown): void {
  if (isTrackableReason(reason)) {
    forwardedReasons.delete(reason);
    return;
  }
  forwardedPrimitiveReasons.delete(String(reason));
}

function wasForwardedReason(reason: unknown): boolean {
  if (isTrackableReason(reason)) {
    return forwardedReasons.has(reason);
  }
  return forwardedPrimitiveReasons.has(String(reason));
}

function shouldPreserveDefaultUnhandledRejectionBehavior(): boolean {
  return process.listeners("unhandledRejection").length === 1;
}

export function installConsoleTap(): void {
  if (installed) return;
  installed = true;

  function ensureStream(): WriteStream | null {
    const date = _dateNow().toISOString().slice(0, 10);
    if (date !== currentDate || !stream) {
      closeStream();
      const dir = resolveServerLogDir(date);
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        return null;
      }
      currentDate = date;
      stream = createWriteStream(join(dir, "console.log"), { flags: "a" });
      stream.on("error", () => {
        // Swallow and reset write errors — never crash the server due to logging.
        stream = null;
        currentDate = "";
      });
    }
    return stream;
  }

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  function formatArgs(args: unknown[]): string {
    return args
      .map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
  }

  function writeLine(level: string, args: unknown[]): void {
    const s = ensureStream();
    if (!s) return;
    const ts = _dateNow().toISOString();
    const msg = formatArgs(args);
    s.write(`${ts} [${level}] ${msg}\n`);
  }

  console.log = (...args: unknown[]) => {
    origLog(...args);
    writeLine("LOG", args);
  };

  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    writeLine("WARN", args);
  };

  console.error = (...args: unknown[]) => {
    origError(...args);
    writeLine("ERROR", args);
  };

  restoreConsole = () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  };

  uncaughtExceptionMonitorHandler = (reason) => {
    if (wasForwardedReason(reason)) {
      clearForwardedReason(reason);
      return;
    }
    if (reason instanceof Error) {
      writeLine("FATAL", [`Uncaught exception: ${reason.message}`, reason.stack ?? ""]);
      return;
    }
    writeLine("FATAL", ["Uncaught exception:", reason]);
  };
  process.on("uncaughtExceptionMonitor", uncaughtExceptionMonitorHandler);

  unhandledRejectionHandler = (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    writeLine("FATAL", [`Unhandled rejection: ${msg}`, stack ?? ""]);
    if (shouldPreserveDefaultUnhandledRejectionBehavior()) {
      markForwardedReason(reason);
      _rethrowUnhandledRejection(reason);
    }
  };
  process.on("unhandledRejection", unhandledRejectionHandler);

  console.log("[console-tap] Console output tee active");
}

export function _resetConsoleTapForTests(): void {
  if (restoreConsole) {
    restoreConsole();
    restoreConsole = null;
  }
  if (uncaughtExceptionMonitorHandler) {
    process.removeListener(
      "uncaughtExceptionMonitor",
      uncaughtExceptionMonitorHandler,
    );
    uncaughtExceptionMonitorHandler = null;
  }
  if (unhandledRejectionHandler) {
    process.removeListener("unhandledRejection", unhandledRejectionHandler);
    unhandledRejectionHandler = null;
  }
  closeStream();
  installed = false;
  _dateNow = () => new Date();
  _setUnhandledRejectionRethrow(null);
  forwardedPrimitiveReasons.clear();
}
