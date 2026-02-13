"use client";

import { useEffect, useRef, useCallback } from "react";
import { Square, Maximize2, Minimize2, X } from "lucide-react";
import { useTerminalStore } from "@/stores/terminal-store";
import { connectToSession, abortSession } from "@/lib/terminal-api";
import type { TerminalEvent } from "@/lib/types";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-400",
  completed: "bg-blue-500",
  error: "bg-red-500",
  aborted: "bg-yellow-500",
  idle: "bg-gray-500",
};

export function TerminalPanel() {
  const {
    panelOpen,
    panelHeight,
    activeTerminal,
    closePanel,
    setPanelHeight,
    updateStatus,
  } = useTerminalStore();

  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<XtermFitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const isMaximized = panelHeight > 70;

  const handleAbort = useCallback(async () => {
    if (!activeTerminal) return;
    await abortSession(activeTerminal.sessionId);
    updateStatus("aborted");
  }, [activeTerminal, updateStatus]);

  const toggleMaximize = useCallback(() => {
    setPanelHeight(isMaximized ? 35 : 80);
  }, [isMaximized, setPanelHeight]);

  // Initialize xterm + connect to SSE
  useEffect(() => {
    if (!panelOpen || !activeTerminal || !termContainerRef.current) return;

    let term: XtermTerminal | null = null;
    let disposed = false;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      // We also need the CSS - inject a link tag if not present
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
        fontFamily: "var(--font-geist-mono), monospace",
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

      liveTerm.writeln(
        `\x1b[36m▶ Shipping bead: ${activeTerminal.beadId}\x1b[0m`
      );
      liveTerm.writeln(
        `\x1b[90m  ${activeTerminal.beadTitle}\x1b[0m`
      );
      liveTerm.writeln("");

      // Connect SSE
      const cleanup = connectToSession(
        activeTerminal.sessionId,
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
              liveTerm.writeln(
                `\x1b[31m✗ Process exited with code ${code}\x1b[0m`
              );
            }
            updateStatus(code === 0 ? "completed" : "error");
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
  }, [panelOpen, activeTerminal?.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle resize
  useEffect(() => {
    if (!panelOpen || !fitRef.current) return;
    const timeout = setTimeout(() => fitRef.current?.fit(), 100);
    return () => clearTimeout(timeout);
  }, [panelOpen, panelHeight]);

  // Handle window resize
  useEffect(() => {
    if (!panelOpen) return;
    const handleResize = () => fitRef.current?.fit();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [panelOpen]);

  if (!panelOpen) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 flex flex-col border-t border-border bg-[#1a1a2e]"
      style={{ height: `${panelHeight}vh` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#16162a] border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          {activeTerminal && (
            <>
              <span className="text-[11px] font-mono text-blue-400 shrink-0">
                {activeTerminal.beadId.replace(/^[^-]+-/, "")}
              </span>
              <span className="text-[11px] text-white/50 truncate">
                {activeTerminal.beadTitle}
              </span>
              {activeTerminal.status === "running" ? (
                <span
                  className="inline-block size-2 rounded-full bg-blue-400 shadow-[0_0_8px_#60a5fa] animate-pulse"
                  title="running"
                />
              ) : activeTerminal.status === "aborted" ? (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-red-400">
                  [terminated]
                </span>
              ) : (
                <span
                  className={`inline-block size-2 rounded-full ${STATUS_COLORS[activeTerminal.status] ?? STATUS_COLORS.idle}`}
                  title={activeTerminal.status}
                />
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeTerminal?.status === "running" && (
            <button
              type="button"
              className="rounded p-1 text-red-300 hover:bg-red-600/20 hover:text-red-200"
              title="terminate"
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

      {/* Terminal content */}
      <div ref={termContainerRef} className="flex-1 overflow-hidden px-1 py-1" />
    </div>
  );
}
