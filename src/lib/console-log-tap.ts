import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveInteractionLogRoot } from "@/lib/interaction-logger";

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

export function installConsoleTap(): void {
  if (installed) return;
  installed = true;

  const date = new Date().toISOString().slice(0, 10);
  const dir = join(resolveInteractionLogRoot(), "_server", date);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // If we can't create the dir, bail silently — don't break the app.
    return;
  }

  const filePath = join(dir, "console.log");
  const stream = createWriteStream(filePath, { flags: "a" });

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
    const ts = new Date().toISOString();
    const msg = formatArgs(args);
    stream.write(`${ts} [${level}] ${msg}\n`);
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

  // Catch unhandled rejections and uncaught exceptions too
  process.on("uncaughtException", (err) => {
    writeLine("FATAL", [`Uncaught exception: ${err.message}`, err.stack ?? ""]);
    stream.write("", () => { /* flush */ });
  });

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    writeLine("FATAL", [`Unhandled rejection: ${msg}`, stack ?? ""]);
  });

  origLog(`[console-tap] Logging all console output to ${filePath}`);
}
