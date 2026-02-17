"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { Square, Maximize2, Minimize2, X } from "lucide-react";
import { useTerminalStore, getActiveTerminal } from "@/stores/terminal-store";
import { connectToSession, abortSession } from "@/lib/terminal-api";
import { useAgentInfo } from "@/hooks/use-agent-info";
import { AgentInfoBar } from "@/components/agent-info-bar";
import type { TerminalEvent } from "@/lib/types";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-400",
  completed: "bg-green-500",
  error: "bg-red-500",
  aborted: "bg-yellow-500",
  idle: "bg-gray-500",
};

const AUTO_CLOSE_MS = 5_000;

function shortId(id: string): string {
  return id.replace(/^[^-]+-/, "");
}

export function TerminalPanel() {
  const {
    panelOpen,
    panelHeight,
    terminals,
    activeSessionId,
    pendingClose,
    closePanel,
    setPanelHeight,
    setActiveSession,
    removeTerminal,
    updateStatus,
    markPendingClose,
    cancelPendingClose,
  } = useTerminalStore();

  const activeTerminal = useMemo(
    () => getActiveTerminal(terminals, activeSessionId),
    [activeSessionId, terminals]
  );
  const activeSessionKey = activeTerminal?.sessionId ?? null;
  const activeBeadId = activeTerminal?.beadId ?? null;
  const activeBeadTitle = activeTerminal?.beadTitle ?? null;

  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<XtermFitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const autoCloseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isMaximized = panelHeight > 70;
  const agentAction = activeTerminal?.beadIds ? "scene" : "take";
  const agentInfo = useAgentInfo(agentAction);

  const handleAbort = useCallback(async () => {
    if (!activeTerminal) return;
    await abortSession(activeTerminal.sessionId);
    updateStatus(activeTerminal.sessionId, "aborted");
  }, [activeTerminal, updateStatus]);

  const toggleMaximize = useCallback(() => {
    setPanelHeight(isMaximized ? 35 : 80);
  }, [isMaximized, setPanelHeight]);

  // Auto-close tabs after process completion
  useEffect(() => {
    for (const terminal of terminals) {
      const isDone = terminal.status === "completed" || terminal.status === "error";
      const alreadyPending = pendingClose.has(terminal.sessionId);
      const hasTimer = autoCloseTimers.current.has(terminal.sessionId);

      if (isDone && !alreadyPending && !hasTimer) {
        markPendingClose(terminal.sessionId);
        const timer = setTimeout(() => {
          autoCloseTimers.current.delete(terminal.sessionId);
          const current = useTerminalStore.getState();
          if (current.pendingClose.has(terminal.sessionId)) {
            removeTerminal(terminal.sessionId);
          }
        }, AUTO_CLOSE_MS);
        autoCloseTimers.current.set(terminal.sessionId, timer);
      }

      // If user cancelled pending close, clear the timer
      if (!isDone || (!alreadyPending && hasTimer)) {
        const existingTimer = autoCloseTimers.current.get(terminal.sessionId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          autoCloseTimers.current.delete(terminal.sessionId);
        }
      }
    }

    // Clean up timers for removed terminals
    for (const [sessionId, timer] of autoCloseTimers.current) {
      if (!terminals.some((t) => t.sessionId === sessionId)) {
        clearTimeout(timer);
        autoCloseTimers.current.delete(sessionId);
      }
    }
  }, [terminals, pendingClose, markPendingClose, removeTerminal]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of autoCloseTimers.current.values()) {
        clearTimeout(timer);
      }
      autoCloseTimers.current.clear();
    };
  }, []);

  const handleTabClick = useCallback((sessionId: string) => {
    cancelPendingClose(sessionId);
    const timer = autoCloseTimers.current.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      autoCloseTimers.current.delete(sessionId);
    }
    setActiveSession(sessionId);
  }, [setActiveSession, cancelPendingClose]);

  // Initialize xterm + connect to SSE for active session
  useEffect(() => {
    if (!panelOpen || !activeSessionKey || !activeBeadId || !activeBeadTitle || !termContainerRef.current) {
      return;
    }
    const sessionId = activeSessionKey;
    const beadId = activeBeadId;
    const beadTitle = activeBeadTitle;

    let term: XtermTerminal | null = null;
    let disposed = false;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!document.querySelector('link[href*="xterm"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/css/xterm.css";
        document.head.appendChild(link);
      }

      if (disposed) return;

      term = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: 13,
        fontFamily: "var(--font-ibm-plex-mono), monospace",
        theme: {
          background: "#1a1a2e",
          foreground: "#e0e0e0",
          cursor: "#e0e0e0",
          red: "#ff6b6b",
          green: "#51cf66",
          yellow: "#ffd43b",
          blue: "#74c0fc",
        },
        convertEol: true,
        scrollback: 5000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termContainerRef.current!);
      fitAddon.fit();

      termRef.current = term;
      fitRef.current = fitAddon;
      const liveTerm = term;

      if (activeTerminal?.beadIds) {
        liveTerm.writeln(
          `\x1b[36m▶ Scene: rolling ${activeTerminal.beadIds.length} beads\x1b[0m`
        );
        for (const bid of activeTerminal.beadIds) {
          liveTerm.writeln(`\x1b[90m  - ${bid}\x1b[0m`);
        }
      } else {
        liveTerm.writeln(
          `\x1b[36m▶ Rolling beat: ${beadId}\x1b[0m`
        );
        liveTerm.writeln(`\x1b[90m  ${beadTitle}\x1b[0m`);
      }
      liveTerm.writeln("");

      const cleanup = connectToSession(
        sessionId,
        (event: TerminalEvent) => {
          if (disposed) return;
          if (event.type === "stdout") {
            liveTerm.write(event.data);
          } else if (event.type === "stderr") {
            liveTerm.write(`\x1b[31m${event.data}\x1b[0m`);
          } else if (event.type === "exit") {
            const code = parseInt(event.data, 10);
            liveTerm.writeln("");
            if (code === 0) {
              liveTerm.writeln("\x1b[32m✓ Process completed successfully\x1b[0m");
            } else {
              liveTerm.writeln(`\x1b[31m✗ Process exited with code ${code}\x1b[0m`);
            }
            updateStatus(sessionId, code === 0 ? "completed" : "error");
          }
        },
        () => {
          if (!disposed) {
            liveTerm.writeln("\x1b[31m✗ Connection lost\x1b[0m");
          }
        }
      );

      cleanupRef.current = cleanup;
    };

    init();

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (term) {
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      }
    };
  }, [panelOpen, activeSessionKey, activeBeadId, activeBeadTitle, updateStatus]);

  useEffect(() => {
    if (!panelOpen || !fitRef.current) return;
    const timeout = setTimeout(() => fitRef.current?.fit(), 100);
    return () => clearTimeout(timeout);
  }, [panelOpen, panelHeight]);

  useEffect(() => {
    if (!panelOpen) return;
    const handleResize = () => fitRef.current?.fit();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [panelOpen]);

  if (!panelOpen || terminals.length === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 flex flex-col border-t border-border bg-[#1a1a2e]"
      style={{ height: `${panelHeight}vh` }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#16162a] px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
            {terminals.map((terminal) => {
              const isActive = terminal.sessionId === activeTerminal?.sessionId;
              const isRunning = terminal.status === "running";
              const isPending = pendingClose.has(terminal.sessionId);
              return (
                <button
                  key={terminal.sessionId}
                  type="button"
                  className={`group inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
                    isPending
                      ? "animate-pulse bg-amber-500/30 text-amber-200"
                      : isActive
                        ? "bg-white/15 text-white"
                        : "bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                  onClick={() => handleTabClick(terminal.sessionId)}
                  title={isPending ? "Click to keep open" : `${terminal.beadId} - ${terminal.beadTitle}`}
                >
                  <span className="font-mono">
                    {terminal.beadIds
                      ? `Scene (${terminal.beadIds.length})`
                      : shortId(terminal.beadId)}
                  </span>
                  {terminal.beadTitle && (
                    <span className="truncate text-white/50">
                      {terminal.beadTitle.slice(0, 40)}
                    </span>
                  )}
                  {isRunning ? (
                    <span className="inline-block size-1.5 rounded-full bg-blue-400 animate-pulse" />
                  ) : (
                    <span
                      className={`rounded p-0.5 ${
                        terminal.status === "completed"
                          ? "text-green-400 hover:bg-white/10 hover:text-green-300"
                          : "text-white/55 hover:bg-white/10 hover:text-white"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeTerminal(terminal.sessionId);
                      }}
                      title="Close tab"
                    >
                      <X className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activeTerminal &&
            (activeTerminal.status === "running" ? (
              <span
                className="inline-block size-2 shrink-0 rounded-full bg-blue-400 shadow-[0_0_8px_#60a5fa] animate-pulse"
                title="running"
              />
            ) : activeTerminal.status === "aborted" ? (
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-red-400">
                [terminated]
              </span>
            ) : activeTerminal.status === "completed" ? (
              <span
                className="inline-block size-2 shrink-0 rounded-full bg-green-500"
                title="completed"
              />
            ) : (
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${
                  STATUS_COLORS[activeTerminal.status] ?? STATUS_COLORS.idle
                }`}
                title={activeTerminal.status}
              />
            ))}
        </div>

        <div className="flex items-center gap-1">
          {activeTerminal?.status === "running" && (
            <button
              type="button"
              className="rounded bg-red-600 p-1 text-white hover:bg-red-500"
              title="Terminate"
              onClick={handleAbort}
            >
              <Square className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
            title={isMaximized ? "Restore" : "Maximize"}
            onClick={toggleMaximize}
          >
            {isMaximized ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
            title="Close"
            onClick={closePanel}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {agentInfo && <AgentInfoBar agent={agentInfo} />}

      <div ref={termContainerRef} className="flex-1 overflow-hidden px-1 py-1" />
    </div>
  );
}
