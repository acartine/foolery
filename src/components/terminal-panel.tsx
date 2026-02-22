"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Square, Maximize2, Minimize2, X } from "lucide-react";
import { useTerminalStore, getActiveTerminal } from "@/stores/terminal-store";
import { connectToSession, abortSession, startSceneSession, startSession } from "@/lib/terminal-api";
import { fetchBead } from "@/lib/api";
import { useAgentInfo } from "@/hooks/use-agent-info";
import { AgentInfoBar } from "@/components/agent-info-bar";
import type { TerminalEvent } from "@/lib/types";
import {
  classifyTerminalFailure,
  type TerminalFailureGuidance,
} from "@/lib/terminal-failure";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-400",
  completed: "bg-green-500",
  error: "bg-red-500",
  aborted: "bg-yellow-500",
  idle: "bg-gray-500",
};

const AUTO_CLOSE_MS = 30_000;

function shortId(id: string): string {
  return id.replace(/^[^-]+-/, "");
}

async function allSceneBeadsInVerificationState(
  beadIds: string[],
  repoPath?: string
): Promise<boolean> {
  const results = await Promise.all(beadIds.map((beadId) => fetchBead(beadId, repoPath)));
  return results.every((result) => {
    if (!result.ok || !result.data) return false;
    return (
      result.data.status === "in_progress" &&
      Array.isArray(result.data.labels) &&
      result.data.labels.includes("stage:verification")
    );
  });
}

function buildSceneRecoveryPrompt(previousSessionId: string, beadIds: string[]): string {
  return [
    `Scene recovery for prior session ${previousSessionId}.`,
    "The previous scene stream disconnected before verification state was confirmed.",
    "Use current repository state. Do not redo already-completed work.",
    "If any listed bead is incomplete, finish it and land changes on main per project rules.",
    "If you believe work is complete, verify merge/push state and then run one verification command per bead:",
    ...beadIds.map((beadId) => `bd update ${JSON.stringify(beadId)} --status in_progress --add-label stage:verification`),
    "Finish with a concise per-bead summary: merged yes/no, pushed yes/no, verification command result.",
  ].join("\n");
}

function buildTakeRecoveryPrompt(beadId: string, previousSessionId: string | null): string {
  return [
    `Take recovery for bead ${beadId}.`,
    previousSessionId
      ? `Prior agent session id: ${previousSessionId}.`
      : "No prior agent session id was captured from the failed run.",
    "The previous run failed during a follow-up after primary work completed.",
    "Use current repository state and avoid redoing completed changes.",
    "Confirm merge/push state and run the verification-state command if not already applied:",
    `bd update ${JSON.stringify(beadId)} --status in_progress --add-label stage:verification`,
    "Finish with a concise summary: merged yes/no, pushed yes/no, verification command result.",
  ].join("\n");
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
    upsertTerminal,
    updateStatus,
    markPendingClose,
    cancelPendingClose,
  } = useTerminalStore();

  const queryClient = useQueryClient();

  const activeTerminal = useMemo(
    () => getActiveTerminal(terminals, activeSessionId),
    [activeSessionId, terminals]
  );
  const activeSessionKey = activeTerminal?.sessionId ?? null;
  const activeBeadId = activeTerminal?.beadId ?? null;
  const activeBeadTitle = activeTerminal?.beadTitle ?? null;
  const activeBeadIds = activeTerminal?.beadIds;
  const activeRepoPath = activeTerminal?.repoPath;

  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<XtermFitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const autoCloseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const recentOutputBySession = useRef<Map<string, string>>(new Map());
  const failureHintBySession = useRef<Map<string, TerminalFailureGuidance>>(new Map());
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
      // Keep errored tabs open so users can inspect what failed.
      const isDone = terminal.status === "completed";
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

    // Clean up per-session output/error hints for removed terminals.
    for (const sessionId of recentOutputBySession.current.keys()) {
      if (!terminals.some((t) => t.sessionId === sessionId)) {
        recentOutputBySession.current.delete(sessionId);
        failureHintBySession.current.delete(sessionId);
      }
    }
  }, [terminals, pendingClose, markPendingClose, removeTerminal]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = autoCloseTimers.current;
    const outputs = recentOutputBySession.current;
    const hints = failureHintBySession.current;

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      outputs.clear();
      hints.clear();
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

      if (activeBeadIds) {
        liveTerm.writeln(
          `\x1b[36m▶ Scene: rolling ${activeBeadIds.length} beads\x1b[0m`
        );
        for (const bid of activeBeadIds) {
          liveTerm.writeln(`\x1b[90m  - ${bid}\x1b[0m`);
        }
      } else {
        liveTerm.writeln(
          `\x1b[36m▶ Rolling beat: ${beadId}\x1b[0m`
        );
        liveTerm.writeln(`\x1b[90m  ${beadTitle}\x1b[0m`);
      }
      liveTerm.writeln("");

      let recoveryInFlight = false;
      const appendRecentOutput = (chunk: string) => {
        if (!chunk) return;
        const previous = recentOutputBySession.current.get(sessionId) ?? "";
        const combined = previous + chunk;
        // Keep a bounded tail to avoid unbounded memory growth.
        recentOutputBySession.current.set(
          sessionId,
          combined.length > 16_000 ? combined.slice(-16_000) : combined
        );
      };

      const launchRecoverySession = async (
        previousSessionId: string | null,
        source: "disconnect" | "retry"
      ) => {
        if (recoveryInFlight) return;
        recoveryInFlight = true;

        const sceneBeadIds = activeBeadIds;
        if (sceneBeadIds && sceneBeadIds.length > 0) {
          if (source === "disconnect") {
            liveTerm.writeln(
              "\x1b[33m⚠ Scene stream disconnected. Checking verification state...\x1b[0m"
            );

            const alreadyVerified = await allSceneBeadsInVerificationState(
              sceneBeadIds,
              activeRepoPath
            );
            if (disposed) return;

            if (alreadyVerified) {
              liveTerm.writeln(
                "\x1b[32m✓ All scene beads already in verification. Closing terminal tab.\x1b[0m"
              );
              updateStatus(sessionId, "completed");
              removeTerminal(sessionId);
              return;
            }

            liveTerm.writeln(
              "\x1b[33m↻ Resuming scene to finish verification workflow...\x1b[0m"
            );
          } else {
            liveTerm.writeln(
              "\x1b[33m↻ Retrying scene with recovery prompt...\x1b[0m"
            );
          }

          const recovery = await startSceneSession(
            sceneBeadIds,
            activeRepoPath,
            buildSceneRecoveryPrompt(previousSessionId ?? sessionId, sceneBeadIds)
          );
          if (disposed) return;

          if (!recovery.ok || !recovery.data) {
            liveTerm.writeln(
              `\x1b[31m✗ Recovery launch failed: ${recovery.error ?? "unknown error"}\x1b[0m`
            );
            updateStatus(sessionId, "error");
            toast.error(recovery.error ?? "Failed to launch recovery scene session");
            recoveryInFlight = false;
            return;
          }

          upsertTerminal({
            sessionId: recovery.data.id,
            beadId: recovery.data.beadId,
            beadTitle: recovery.data.beadTitle,
            beadIds: recovery.data.beadIds,
            repoPath: recovery.data.repoPath ?? activeRepoPath,
            status: "running",
            startedAt: new Date().toISOString(),
          });
          removeTerminal(sessionId);
          toast.info(
            source === "disconnect"
              ? "Scene stream disconnected; started automatic recovery session."
              : "Retry launched with scene recovery prompt."
          );
          return;
        }

        liveTerm.writeln(
          "\x1b[33m↻ Retrying take with recovery prompt...\x1b[0m"
        );
        const recovery = await startSession(
          beadId,
          activeRepoPath,
          buildTakeRecoveryPrompt(beadId, previousSessionId)
        );
        if (disposed) return;

        if (!recovery.ok || !recovery.data) {
          liveTerm.writeln(
            `\x1b[31m✗ Recovery launch failed: ${recovery.error ?? "unknown error"}\x1b[0m`
          );
          updateStatus(sessionId, "error");
          toast.error(recovery.error ?? "Failed to launch recovery take session");
          recoveryInFlight = false;
          return;
        }

        upsertTerminal({
          sessionId: recovery.data.id,
          beadId: recovery.data.beadId,
          beadTitle: recovery.data.beadTitle,
          beadIds: recovery.data.beadIds,
          repoPath: recovery.data.repoPath ?? activeRepoPath,
          status: "running",
          startedAt: new Date().toISOString(),
        });
        removeTerminal(sessionId);
        toast.info("Retry launched with take recovery prompt.");
      };

      const cleanup = connectToSession(
        sessionId,
        (event: TerminalEvent) => {
          if (disposed) return;
          if (event.type === "stdout") {
            appendRecentOutput(event.data);
            liveTerm.write(event.data);
          } else if (event.type === "stderr") {
            appendRecentOutput(event.data);
            liveTerm.write(`\x1b[31m${event.data}\x1b[0m`);
          } else if (event.type === "exit") {
            const code = parseInt(event.data, 10);
            liveTerm.writeln("");
            if (code === 0) {
              liveTerm.writeln("\x1b[32m✓ Process completed successfully\x1b[0m");
            } else {
              liveTerm.writeln(`\x1b[31m✗ Process exited with code ${code}\x1b[0m`);

              const text = recentOutputBySession.current.get(sessionId) ?? "";
              const failureHint =
                failureHintBySession.current.get(sessionId) ??
                classifyTerminalFailure(text, agentInfo?.command);

              if (failureHint) {
                failureHintBySession.current.set(sessionId, failureHint);
                liveTerm.writeln(`\x1b[33m! ${failureHint.title}\x1b[0m`);
                failureHint.steps.forEach((step, index) => {
                  liveTerm.writeln(`\x1b[90m  ${index + 1}. ${step}\x1b[0m`);
                });
                if (failureHint.kind === "missing_cwd") {
                  const retryLabel =
                    activeBeadIds && activeBeadIds.length > 0 ? "Retry Scene" : "Retry Take";
                  liveTerm.writeln(
                    "\x1b[33m? Use the retry action in the toast to relaunch with recovery context.\x1b[0m"
                  );
                  toast.error(failureHint.toast, {
                    duration: 12_000,
                    action: {
                      label: retryLabel,
                      onClick: () => {
                        void launchRecoverySession(failureHint.previousSessionId, "retry");
                      },
                    },
                  });
                } else {
                  toast.error(failureHint.toast);
                }
              } else {
                toast.error(`Session failed (exit code ${code}). Open the terminal tab for details.`);
              }
            }
            updateStatus(sessionId, code === 0 ? "completed" : "error");

            // On successful completion, immediately invalidate bead
            // queries so Final Cut badges and notifications refresh
            // without waiting for the next polling interval.
            if (code === 0) {
              queryClientRef.current.invalidateQueries({
                queryKey: ["beads"],
              });
            }
          }
        },
        () => {
          if (disposed) return;
          if (activeBeadIds && activeBeadIds.length > 0) {
            void launchRecoverySession(sessionId, "disconnect");
            return;
          }
          liveTerm.writeln(
            "\x1b[33m⚠ Session stream disconnected. Reopen the tab to retry stream attachment.\x1b[0m"
          );
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
  }, [
    panelOpen,
    activeSessionKey,
    activeBeadId,
    activeBeadTitle,
    activeBeadIds,
    activeRepoPath,
    removeTerminal,
    upsertTerminal,
    updateStatus,
    agentInfo?.command,
  ]);

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
          <button
            type="button"
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
            title="Copy output"
            onClick={() => {
              const term = termRef.current;
              if (!term) return;
              const buffer = term.buffer.active;
              const lines: string[] = [];
              for (let i = 0; i <= buffer.length - 1; i++) {
                const line = buffer.getLine(i);
                if (line) lines.push(line.translateToString(true));
              }
              while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
              navigator.clipboard.writeText(lines.join("\n"));
              toast.success("Copied terminal output");
            }}
          >
            <Copy className="size-3.5" />
          </button>
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
