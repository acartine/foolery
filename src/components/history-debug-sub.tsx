"use client";

import { useEffect } from "react";
import { TerminalSquare, Sun, Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { connectToSession } from "@/lib/terminal-api";
import type {
  TerminalEvent,
  TerminalSession,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { getTerminalTheme } from "@/lib/terminal-theme";

type DebugSessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "aborted"
  | "disconnected";

function appendEventToTerminal(
  term: XtermTerminal,
  event: TerminalEvent,
): void {
  if (event.type === "stdout") {
    term.write(event.data);
    return;
  }
  if (event.type === "stderr") {
    term.write(`\x1b[31m${event.data}\x1b[0m`);
    return;
  }
  if (event.type === "agent_switch") {
    try {
      const parsed = JSON.parse(
        event.data,
      ) as Record<string, unknown>;
      const nextAgent =
        typeof parsed.agentName === "string"
          ? parsed.agentName
          : "agent";
      term.writeln(
        "\r\n\x1b[36m↻ Agent switched" +
          ` to ${nextAgent}\x1b[0m`,
      );
    } catch {
      term.writeln(
        "\r\n\x1b[36m↻ Agent switched\x1b[0m",
      );
    }
    return;
  }
  if (event.type === "exit") {
    const code = Number.parseInt(event.data, 10);
    if (code === 0) {
      term.writeln(
        "\r\n\x1b[32m✓ Debug session" +
          " completed successfully\x1b[0m",
      );
    } else if (code === -2) {
      term.writeln(
        "\r\n\x1b[33m⚠ Debug session" +
          " disconnected\x1b[0m",
      );
    } else {
      term.writeln(
        "\r\n\x1b[31m✗ Debug session" +
          ` exited with code ${code}\x1b[0m`,
      );
    }
  }
}

function nextStatusForExitCode(
  code: number,
): DebugSessionStatus {
  if (code === 0) return "completed";
  if (code === -2) return "disconnected";
  if (code === 130) return "aborted";
  return "error";
}

export function statusTone(
  status: DebugSessionStatus,
): string {
  if (status === "running")
    return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (status === "completed")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "aborted")
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "disconnected")
    return "border-orange-500/30 bg-orange-500/10 text-orange-200";
  if (status === "error")
    return "border-red-500/30 bg-red-500/10 text-red-200";
  return "border-white/10 bg-white/5 text-white/70";
}

// ── Terminal init effect ──

export function useTerminalEffect(
  containerRef: React.RefObject<
    HTMLDivElement | null
  >,
  termRef: React.MutableRefObject<
    XtermTerminal | null
  >,
  fitRef: React.MutableRefObject<
    XtermFitAddon | null
  >,
  bufferRef: React.MutableRefObject<
    TerminalEvent[]
  >,
  debugSession: TerminalSession | null,
  beatId: string,
  beatTitle: string | undefined,
  setExitCode: (code: number | null) => void,
  setDebugStatus: (
    status: DebugSessionStatus,
  ) => void,
  lightTheme: boolean,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !debugSession) return;

    let disposed = false;
    let unsubscribe = () => {};
    let term: XtermTerminal | null = null;

    const init = async () => {
      term = await createTerminal(container, lightTheme);
      if (disposed) {
        term?.dispose();
        return;
      }

      const fitAddon = await loadFitAddon(term);
      termRef.current = term;
      fitRef.current = fitAddon;

      writeTerminalHeader(
        term,
        debugSession,
        beatId,
        beatTitle,
      );

      for (const event of bufferRef.current) {
        appendEventToTerminal(term, event);
      }

      unsubscribe = connectToSession(
        debugSession.id,
        (event) => {
          handleTermEvent(
            event,
            bufferRef,
            term!,
            setExitCode,
            setDebugStatus,
          );
        },
      );
    };

    void init();

    const handleResize = () =>
      fitRef.current?.fit();
    window.addEventListener(
      "resize",
      handleResize,
    );

    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener(
        "resize",
        handleResize,
      );
      term?.dispose();
      if (termRef.current === term)
        termRef.current = null;
      fitRef.current = null;
    };
  }, [
    beatId,
    beatTitle,
    bufferRef,
    containerRef,
    debugSession,
    fitRef,
    setDebugStatus,
    setExitCode,
    termRef,
    lightTheme,
  ]);
}

async function createTerminal(
  container: HTMLDivElement,
  lightTheme: boolean,
): Promise<XtermTerminal> {
  const { Terminal } = await import(
    "@xterm/xterm"
  );

  if (
    !document.querySelector(
      'link[href*="xterm"]',
    )
  ) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/xterm.css";
    document.head.appendChild(link);
  }

  const term = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
    fontSize: 12,
    fontFamily:
      "var(--font-ibm-plex-mono), monospace",
    theme: getTerminalTheme(lightTheme),
    scrollback: 4_000,
  });

  term.open(container);
  return term;
}

async function loadFitAddon(
  term: XtermTerminal,
): Promise<XtermFitAddon> {
  const { FitAddon } = await import(
    "@xterm/addon-fit"
  );
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  fitAddon.fit();
  term.focus();
  return fitAddon;
}

function writeTerminalHeader(
  term: XtermTerminal,
  debugSession: TerminalSession,
  beatId: string,
  beatTitle: string | undefined,
) {
  const titleSuffix = beatTitle
    ? ` — ${beatTitle}`
    : "";
  term.writeln(
    "\x1b[36m▶ History Debug Session:" +
      ` ${debugSession.id}\x1b[0m`,
  );
  term.writeln(
    `\x1b[90m  Beat: ${beatId}${titleSuffix}\x1b[0m`,
  );
  term.writeln("");
}

function handleTermEvent(
  event: TerminalEvent,
  bufferRef: React.MutableRefObject<
    TerminalEvent[]
  >,
  term: XtermTerminal,
  setExitCode: (code: number | null) => void,
  setDebugStatus: (
    status: DebugSessionStatus,
  ) => void,
) {
  bufferRef.current.push(event);
  if (bufferRef.current.length > 2_000) {
    bufferRef.current =
      bufferRef.current.slice(-2_000);
  }
  if (event.type === "exit") {
    const code = Number.parseInt(event.data, 10);
    setExitCode(
      Number.isFinite(code) ? code : null,
    );
    setDebugStatus(nextStatusForExitCode(code));
  }
  appendEventToTerminal(term, event);
}

// ── Sub-components ──

export function DebugPanelHeader({
  beatId,
  beatTitle,
  debugStatus,
  statusText,
  lightTheme,
  onLightThemeChange,
}: {
  beatId: string;
  beatTitle?: string;
  debugStatus: DebugSessionStatus;
  statusText: string;
  lightTheme: boolean;
  onLightThemeChange: (value: boolean) => void;
}) {
  const subtitle =
    "Launch an isolated debugging session" +
    " from this conversation and" +
    " inspect the result inline.";

  const headerBg = lightTheme
    ? "bg-[linear-gradient(135deg,rgba(245,245,250,0.95),rgba(235,235,240,0.98))]"
    : "bg-[linear-gradient(135deg,rgba(36,52,89,0.95),rgba(13,20,35,0.98))]";
  const borderClass = lightTheme
    ? "border-b border-slate-200"
    : "border-b border-white/10";
  const titleClass = lightTheme
    ? "text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500"
    : "text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/80";
  const headingClass = lightTheme
    ? "mt-2 truncate text-lg font-semibold text-slate-900"
    : "mt-2 truncate text-lg font-semibold text-white";
  const subtitleClass = lightTheme
    ? "mt-1 text-sm text-slate-600"
    : "mt-1 text-sm text-slate-300";
  const toggleTextClass = lightTheme
    ? "text-[11px] text-slate-500"
    : "text-[11px] text-slate-300";
  const switchClass = lightTheme
    ? "data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-slate-300"
    : "data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-white/20";

  return (
    <header className={cn(headerBg, borderClass, "px-5 py-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("flex items-center gap-2", titleClass)}>
            <TerminalSquare className="size-4" />
            History Debugger
          </div>
          <h2 className={headingClass}>
            {beatTitle ?? beatId}
          </h2>
          <p className={subtitleClass}>
            {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded px-1 py-0.5">
            {lightTheme
              ? <Sun className="size-3.5 text-amber-500" />
              : <Moon className="size-3.5 text-slate-400" />}
            <span className={toggleTextClass}>
              Light Theme
            </span>
            <Switch
              checked={lightTheme}
              onCheckedChange={onLightThemeChange}
              aria-label="Light Theme"
              className={switchClass}
            />
          </label>
          <div
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              statusTone(debugStatus),
            )}
          >
            {statusText}
          </div>
        </div>
      </div>
    </header>
  );
}

export function DebugTerminalPanel({
  debugSession,
  terminalContainerRef,
  lightTheme,
}: {
  debugSession: TerminalSession | null;
  terminalContainerRef: React.RefObject<
    HTMLDivElement | null
  >;
  lightTheme: boolean;
}) {
  const bgClass = lightTheme
    ? "bg-[#fafafa]"
    : "bg-[#0b1020]";
  const borderClass = lightTheme
    ? "border-b border-slate-200"
    : "border-b border-white/10";
  const textClass = lightTheme
    ? "text-slate-600"
    : "text-slate-400";
  const placeholderClass = lightTheme
    ? "text-slate-500"
    : "text-slate-400";

  return (
    <div className={cn("flex min-h-[20rem] flex-col", bgClass)}>
      <div className={cn(borderClass, "px-4 py-3 text-xs font-medium uppercase tracking-[0.2em]", textClass)}>
        Embedded Terminal
      </div>
      <div className="relative min-h-0 flex-1">
        {!debugSession ? (
          <div className={cn("absolute inset-0 flex items-center justify-center px-6 text-center text-sm", placeholderClass)}>
            Submit the form to open a dedicated
            debug terminal for this conversation.
          </div>
        ) : null}
        <div
          ref={terminalContainerRef}
          className={cn(
            "h-full min-h-[20rem] w-full p-3 font-mono text-xs",
            debugSession
              ? "opacity-100"
              : "opacity-30",
          )}
        />
      </div>
    </div>
  );
}
