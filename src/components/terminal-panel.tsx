"use client";

import {
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Square,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useTerminalStore, getActiveTerminal } from "@/stores/terminal-store";
import { abortSession, startSession, listSessions } from "@/lib/terminal-api";
import { sessionConnections } from "@/lib/session-connection-manager";
import {
  detectVendor,
  formatModelDisplay,
  useAgentInfo,
  type ResolvedAgentInfo,
} from "@/hooks/use-agent-info";
import { AgentInfoBar } from "@/components/agent-info-bar";
import type { BeatInfoForBar } from "@/components/agent-info-bar";
import { fetchBeat } from "@/lib/api";
import {
  classifyTerminalFailure,
  type TerminalFailureGuidance,
} from "@/lib/terminal-failure";
import { splitTerminalTabBeatId } from "@/lib/terminal-tab-id";
import {
  createCompletionAnimationTracker,
  pruneCompletionAnimationTracker,
  shouldAnimateCompletion,
} from "@/lib/terminal-tab-completion";
import {
  getTerminalTabScrollAmount,
  resolveTerminalTabDisplayLabel,
  resolveTerminalTabStripState,
  shouldUseCompactTerminalTabLabels,
} from "@/lib/terminal-tab-strip";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import { toast } from "sonner";
import { MinimizedTerminalBar } from "@/components/minimized-terminal-bar";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-400",
  completed: "bg-green-500",
  error: "bg-red-500",
  aborted: "bg-yellow-500",
  idle: "bg-gray-500",
  disconnected: "bg-orange-500",
};

const AUTO_CLOSE_MS = 30_000;

function buildTakeRecoveryPrompt(beatId: string, previousSessionId: string | null): string {
  return [
    `Take recovery for beat ${beatId}.`,
    previousSessionId
      ? `Prior agent session id: ${previousSessionId}.`
      : "No prior agent session id was captured from the failed run.",
    "The previous run failed during a follow-up after primary work completed.",
    "Use current repository state and avoid redoing completed changes.",
    "Confirm merge/push state and apply the profile transition command (or Knots claim completion command) for this beat if not already applied.",
    "Finish with a concise summary: merged yes/no, pushed yes/no, transition/claim completion command result.",
  ].join("\n");
}

/**
 * Write the exit status message and failure hints to xterm.
 * Extracted so it can be used both for buffer replay and live events.
 */
function writeExitMessage(
  term: XtermTerminal,
  code: number,
  sessionId: string,
  recentOutputBySession: React.RefObject<Map<string, string>>,
  failureHintBySession: React.RefObject<Map<string, TerminalFailureGuidance>>,
  agentCommand: string | undefined,
  launchRecoverySession: (previousSessionId: string | null) => void,
) {
  term.writeln("");
  if (code === -2) {
    term.writeln("\x1b[33m⚠ Session disconnected — server may have restarted\x1b[0m");
    return;
  } else if (code === 0) {
    term.writeln("\x1b[32m✓ Process completed successfully\x1b[0m");
  } else {
    term.writeln(`\x1b[31m✗ Process exited with code ${code}\x1b[0m`);

    const text = recentOutputBySession.current.get(sessionId) ?? "";
    const failureHint =
      failureHintBySession.current.get(sessionId) ??
      classifyTerminalFailure(text, agentCommand);

    if (failureHint) {
      failureHintBySession.current.set(sessionId, failureHint);
      term.writeln(`\x1b[33m! ${failureHint.title}\x1b[0m`);
      failureHint.steps.forEach((step, index) => {
        term.writeln(`\x1b[90m  ${index + 1}. ${step}\x1b[0m`);
      });
      if (failureHint.kind === "missing_cwd") {
        term.writeln(
          "\x1b[33m? Use the retry action in the toast to relaunch with recovery context.\x1b[0m"
        );
        toast.error(failureHint.toast, {
          duration: 12_000,
          action: {
            label: "Retry Take",
            onClick: () => {
              void launchRecoverySession(failureHint.previousSessionId);
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

  const activeTerminal = useMemo(
    () => getActiveTerminal(terminals, activeSessionId),
    [activeSessionId, terminals]
  );
  const activeSessionKey = activeTerminal?.sessionId ?? null;
  const activeBeatId = activeTerminal?.beatId ?? null;
  const activeBeatTitle = activeTerminal?.beatTitle ?? null;
  const activeRepoPath = activeTerminal?.repoPath;
  const latestTakeStartedAt = useMemo(() => {
    if (!activeBeatId) return activeTerminal?.startedAt;
    let latestStartedAt: string | undefined;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const terminal of terminals) {
      if (terminal.beatId !== activeBeatId) continue;
      const parsed = Date.parse(terminal.startedAt);
      if (!Number.isFinite(parsed)) continue;
      if (parsed > latestMs) {
        latestMs = parsed;
        latestStartedAt = terminal.startedAt;
      }
    }
    return latestStartedAt ?? activeTerminal?.startedAt;
  }, [activeBeatId, activeTerminal?.startedAt, terminals]);

  const termContainerRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<XtermFitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const autoCloseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const completionAnimationTracker = useRef(createCompletionAnimationTracker());
  const recentOutputBySession = useRef<Map<string, string>>(new Map());
  const failureHintBySession = useRef<Map<string, TerminalFailureGuidance>>(new Map());
  const hasRehydrated = useRef(false);
  const [completionAnimationEnabled, setCompletionAnimationEnabled] = useState(false);
  const [tabStripState, setTabStripState] = useState(() =>
    resolveTerminalTabStripState({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0 }),
  );
  const [compactTabLabels, setCompactTabLabels] = useState(false);
  const isMaximized = panelHeight > 70;
  const fallbackAgentInfo = useAgentInfo("take");
  const sessionAgentInfo = useMemo<ResolvedAgentInfo | null>(() => {
    if (!activeTerminal?.agentCommand) return null;
    return {
      name: activeTerminal.agentName || activeTerminal.agentCommand,
      model: formatModelDisplay(activeTerminal.agentModel),
      version: activeTerminal.agentVersion,
      command: activeTerminal.agentCommand,
      vendor: detectVendor(activeTerminal.agentCommand),
    };
  }, [
    activeTerminal?.agentCommand,
    activeTerminal?.agentModel,
    activeTerminal?.agentName,
    activeTerminal?.agentVersion,
  ]);
  const agentInfo = sessionAgentInfo ?? fallbackAgentInfo;

  // Fetch beat data for the info bar (state + timestamps)
  const beatQuery = useQuery({
    queryKey: ["beat", activeBeatId, activeRepoPath],
    queryFn: () => fetchBeat(activeBeatId!, activeRepoPath),
    enabled: !!activeBeatId,
    refetchInterval: 15_000,
  });

  const beatInfoForBar = useMemo<BeatInfoForBar | null>(() => {
    const beat = beatQuery.data?.data;
    if (!beat) return null;
    return {
      state: beat.state,
      stateChangedAt: beat.updated,
      createdAt: beat.created,
      latestTakeStartedAt,
    };
  }, [beatQuery.data?.data, latestTakeStartedAt]);

  const handleAbort = useCallback(async () => {
    if (!activeTerminal) return;
    await abortSession(activeTerminal.sessionId);
    updateStatus(activeTerminal.sessionId, "aborted");
  }, [activeTerminal, updateStatus]);

  const toggleMaximize = useCallback(() => {
    setPanelHeight(isMaximized ? 35 : 80);
  }, [isMaximized, setPanelHeight]);

  const syncTabStripState = useCallback(() => {
    const tabStrip = tabStripRef.current;
    if (!tabStrip) {
      setTabStripState(
        resolveTerminalTabStripState({
          scrollLeft: 0,
          scrollWidth: 0,
          clientWidth: 0,
        }),
      );
      setCompactTabLabels(false);
      return;
    }

    const nextState = resolveTerminalTabStripState({
      scrollLeft: tabStrip.scrollLeft,
      scrollWidth: tabStrip.scrollWidth,
      clientWidth: tabStrip.clientWidth,
    });

    setTabStripState(nextState);
    setCompactTabLabels(
      shouldUseCompactTerminalTabLabels(
        nextState.hasOverflow,
        tabStrip.clientWidth,
        terminals.length,
      ),
    );
  }, [terminals.length]);

  const scrollTabStrip = useCallback(
    (direction: -1 | 1) => {
      const tabStrip = tabStripRef.current;
      if (!tabStrip) return;
      const amount = getTerminalTabScrollAmount(tabStrip.clientWidth);
      tabStrip.scrollBy({
        left: direction * amount,
        behavior: "smooth",
      });
      requestAnimationFrame(syncTabStripState);
      window.setTimeout(syncTabStripState, 180);
    },
    [syncTabStripState],
  );

  const handleTabStripWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const tabStrip = tabStripRef.current;
      if (!tabStrip || !tabStripState.hasOverflow) return;

      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      tabStrip.scrollBy({
        left: event.deltaY,
      });
      syncTabStripState();
    },
    [syncTabStripState, tabStripState.hasOverflow],
  );

  // Auto-close tabs after process completion
  useEffect(() => {
    const activeSessionIds = new Set(terminals.map((terminal) => terminal.sessionId));

    for (const terminal of terminals) {
      // Keep errored tabs open so users can inspect what failed.
      const isDone = terminal.status === "completed";
      const alreadyPending = pendingClose.has(terminal.sessionId);
      const hasTimer = autoCloseTimers.current.has(terminal.sessionId);
      const shouldPulseCompletion = shouldAnimateCompletion(
        completionAnimationTracker.current,
        terminal.sessionId,
        terminal.status,
        { allowAnimation: completionAnimationEnabled },
      );

      if (shouldPulseCompletion && !alreadyPending && !hasTimer) {
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
      if (!activeSessionIds.has(sessionId)) {
        clearTimeout(timer);
        autoCloseTimers.current.delete(sessionId);
      }
    }
    pruneCompletionAnimationTracker(
      completionAnimationTracker.current,
      activeSessionIds,
    );

    // Clean up per-session output/error hints for removed terminals.
    for (const sessionId of recentOutputBySession.current.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        recentOutputBySession.current.delete(sessionId);
        failureHintBySession.current.delete(sessionId);
      }
    }
  }, [
    terminals,
    pendingClose,
    markPendingClose,
    removeTerminal,
    completionAnimationEnabled,
  ]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = autoCloseTimers.current;
    const completionTracker = completionAnimationTracker.current;
    const outputs = recentOutputBySession.current;
    const hints = failureHintBySession.current;

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      completionTracker.seenSessionIds.clear();
      completionTracker.previousStatusBySession.clear();
      outputs.clear();
      hints.clear();
    };
  }, []);

  // Rehydrate persisted terminals from backend on first mount
  useEffect(() => {
    if (hasRehydrated.current) return;
    hasRehydrated.current = true;
    let cancelled = false;
    const enableCompletionAnimation = () => {
      if (!cancelled) {
        setCompletionAnimationEnabled(true);
      }
    };
    const { terminals } = useTerminalStore.getState();
    if (terminals.length === 0) {
      enableCompletionAnimation();
      return () => {
        cancelled = true;
      };
    }
    listSessions()
      .then((sessions) => {
        useTerminalStore.getState().rehydrateFromBackend(sessions);
      })
      .finally(enableCompletionAnimation);
    return () => {
      cancelled = true;
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

  // Initialize xterm + subscribe to session-connection-manager for active session
  useEffect(() => {
    if (!panelOpen || !activeSessionKey || !activeBeatId || !activeBeatTitle || !termContainerRef.current) {
      return;
    }
    const sessionId = activeSessionKey;
    const beatId = activeBeatId;
    const beatTitle = activeBeatTitle;

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

      liveTerm.writeln(
        `\x1b[36m▶ Rolling beat: ${beatId}\x1b[0m`
      );
      liveTerm.writeln(`\x1b[90m  ${beatTitle}\x1b[0m`);
      liveTerm.writeln("");

      let recoveryInFlight = false;
      const appendRecentOutput = (chunk: string) => {
        if (!chunk) return;
        const previous = recentOutputBySession.current.get(sessionId) ?? "";
        const combined = previous + chunk;
        recentOutputBySession.current.set(
          sessionId,
          combined.length > 16_000 ? combined.slice(-16_000) : combined
        );
      };

      const launchRecoverySession = async (previousSessionId: string | null) => {
        if (recoveryInFlight) return;
        recoveryInFlight = true;

        liveTerm.writeln(
          "\x1b[33m↻ Retrying take with recovery prompt...\x1b[0m"
        );
        const recovery = await startSession(
          beatId,
          activeRepoPath,
          buildTakeRecoveryPrompt(beatId, previousSessionId)
        );
        if (disposed) return;

        if (!recovery.ok || !recovery.data) {
          liveTerm.writeln(
            `\x1b[31m✗ Recovery launch failed: ${recovery.error ?? "unknown error"}\x1b[0m`
          );
          useTerminalStore.getState().updateStatus(sessionId, "error");
          toast.error(recovery.error ?? "Failed to launch recovery take session");
          recoveryInFlight = false;
          return;
        }

        upsertTerminal({
          sessionId: recovery.data.id,
          beatId: recovery.data.beatId,
          beatTitle: recovery.data.beatTitle,
          repoPath: recovery.data.repoPath ?? activeRepoPath,
          agentName: recovery.data.agentName,
          agentModel: recovery.data.agentModel,
          agentVersion: recovery.data.agentVersion,
          agentCommand: recovery.data.agentCommand,
          status: "running",
          startedAt: recovery.data.startedAt,
        });
        removeTerminal(sessionId);
        toast.info("Retry launched with take recovery prompt.");
      };

      // Replay buffered output from the connection manager
      const buffer = sessionConnections.getBuffer(sessionId);
      for (const entry of buffer) {
        if (entry.type === "stdout") {
          appendRecentOutput(entry.data);
          liveTerm.write(entry.data);
        } else if (entry.type === "stderr") {
          appendRecentOutput(entry.data);
          liveTerm.write(`\x1b[31m${entry.data}\x1b[0m`);
        } else if (entry.type === "exit") {
          writeExitMessage(liveTerm, parseInt(entry.data, 10), sessionId, recentOutputBySession, failureHintBySession, agentInfo?.command, launchRecoverySession);
        }
      }

      // If exit was already received (e.g., completed while on another tab),
      // write the exit message if buffer didn't already contain it
      if (sessionConnections.hasExited(sessionId) && !buffer.some((e) => e.type === "exit")) {
        const code = sessionConnections.getExitCode(sessionId) ?? 0;
        writeExitMessage(liveTerm, code, sessionId, recentOutputBySession, failureHintBySession, agentInfo?.command, launchRecoverySession);
      }

      // Subscribe to live events going forward
      const unsubscribe = sessionConnections.subscribe(sessionId, (event) => {
        if (disposed) return;
        if (event.type === "stdout") {
          appendRecentOutput(event.data);
          liveTerm.write(event.data);
        } else if (event.type === "stderr") {
          appendRecentOutput(event.data);
          liveTerm.write(`\x1b[31m${event.data}\x1b[0m`);
        } else if (event.type === "exit") {
          writeExitMessage(liveTerm, parseInt(event.data, 10), sessionId, recentOutputBySession, failureHintBySession, agentInfo?.command, launchRecoverySession);
        }
      });

      cleanupRef.current = unsubscribe;
    };

    init();

    return () => {
      disposed = true;
      // Unsubscribe from live events — but do NOT disconnect the SSE
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
    activeBeatId,
    activeBeatTitle,
    activeRepoPath,
    removeTerminal,
    upsertTerminal,
    agentInfo?.command,
  ]);

  useEffect(() => {
    if (!panelOpen || !fitRef.current) return;
    const timeout = setTimeout(() => fitRef.current?.fit(), 100);
    return () => clearTimeout(timeout);
  }, [panelOpen, panelHeight]);

  useEffect(() => {
    if (!panelOpen) return;
    const handleResize = () => {
      fitRef.current?.fit();
      syncTabStripState();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [panelOpen, syncTabStripState]);

  useEffect(() => {
    if (!panelOpen) return;
    const frame = requestAnimationFrame(syncTabStripState);
    return () => cancelAnimationFrame(frame);
  }, [panelOpen, panelHeight, terminals.length, syncTabStripState]);

  useEffect(() => {
    if (!panelOpen || !activeSessionKey) return;
    const button = tabButtonRefs.current.get(activeSessionKey);
    if (!button) return;
    button.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    requestAnimationFrame(syncTabStripState);
  }, [activeSessionKey, panelOpen, syncTabStripState, terminals.length]);

  useEffect(() => {
    if (!panelOpen || !tabStripState.hasOverflow) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInputTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isTextInputTarget) return;

      if (event.altKey && event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        scrollTabStrip(-1);
      }

      if (event.altKey && event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        scrollTabStrip(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panelOpen, scrollTabStrip, tabStripState.hasOverflow]);

  if (terminals.length === 0) return null;

  if (!panelOpen) {
    return <MinimizedTerminalBar />;
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 flex flex-col border-t border-border bg-[#1a1a2e]"
      style={{ height: `${panelHeight}vh` }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#16162a] px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {tabStripState.hasOverflow && (
              <button
                type="button"
                className="shrink-0 rounded border border-white/10 p-1 text-white/55 transition-colors enabled:hover:border-white/30 enabled:hover:bg-white/10 enabled:hover:text-white disabled:opacity-30"
                aria-label="Scroll terminal tabs left"
                title="Scroll tabs left (Alt+Shift+Left)"
                onClick={() => scrollTabStrip(-1)}
                disabled={!tabStripState.canScrollLeft}
              >
                <ChevronLeft className="size-3.5" />
              </button>
            )}

            <div className="relative min-w-0 flex-1">
              {tabStripState.hasOverflow && (
                <div
                  className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[#16162a] to-transparent transition-opacity ${
                    tabStripState.canScrollLeft ? "opacity-100" : "opacity-0"
                  }`}
                />
              )}
              <div
                ref={tabStripRef}
                className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5"
                onScroll={syncTabStripState}
                onWheel={handleTabStripWheel}
              >
                {terminals.map((terminal) => {
                  const isActive = terminal.sessionId === activeTerminal?.sessionId;
                  const isRunning = terminal.status === "running";
                  const isPending = pendingClose.has(terminal.sessionId);
                  const beatIdParts = splitTerminalTabBeatId(terminal.beatId);
                  const displayLabel = resolveTerminalTabDisplayLabel(
                    beatIdParts,
                    compactTabLabels,
                  );
                  return (
                    <button
                      key={terminal.sessionId}
                      ref={(node) => {
                        if (node) {
                          tabButtonRefs.current.set(terminal.sessionId, node);
                        } else {
                          tabButtonRefs.current.delete(terminal.sessionId);
                        }
                      }}
                      type="button"
                      className={`group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2 py-1 text-[11px] transition-colors ${
                        compactTabLabels ? "max-w-[132px]" : "max-w-[270px]"
                      } ${
                        isPending
                          ? "animate-pulse border-amber-400/40 bg-amber-500/30 text-amber-200"
                          : isActive
                            ? "border-white/25 bg-white/15 text-white"
                            : "border-transparent bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10"
                      }`}
                      onClick={() => handleTabClick(terminal.sessionId)}
                      title={
                        isPending
                          ? "Click to keep open"
                          : `${terminal.beatId}${terminal.beatTitle ? ` - ${terminal.beatTitle}` : ""}`
                      }
                    >
                      <span className="flex min-w-0 items-center gap-0.5 font-mono">
                        {displayLabel.prefix ? (
                          <>
                            <span className="min-w-0 truncate text-white/45">
                              {displayLabel.prefix}
                            </span>
                            <span className="shrink-0">{displayLabel.localId}</span>
                          </>
                        ) : (
                          <span className="truncate">{displayLabel.localId}</span>
                        )}
                      </span>
                      {!compactTabLabels && terminal.beatTitle && (
                        <span className="max-w-[160px] truncate text-white/50">
                          {terminal.beatTitle}
                        </span>
                      )}
                      {isRunning ? (
                        <span className="inline-block size-1.5 shrink-0 rounded-full bg-blue-400 animate-pulse" />
                      ) : (
                        <span
                          className={`shrink-0 rounded p-0.5 ${
                            terminal.status === "completed"
                              ? "text-green-400 hover:bg-white/10 hover:text-green-300"
                              : terminal.status === "disconnected"
                                ? "text-orange-400 hover:bg-white/10 hover:text-orange-300"
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
              {tabStripState.hasOverflow && (
                <div
                  className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#16162a] to-transparent transition-opacity ${
                    tabStripState.canScrollRight ? "opacity-100" : "opacity-0"
                  }`}
                />
              )}
            </div>

            {tabStripState.hasOverflow && (
              <button
                type="button"
                className="shrink-0 rounded border border-white/10 p-1 text-white/55 transition-colors enabled:hover:border-white/30 enabled:hover:bg-white/10 enabled:hover:text-white disabled:opacity-30"
                aria-label="Scroll terminal tabs right"
                title="Scroll tabs right (Alt+Shift+Right)"
                onClick={() => scrollTabStrip(1)}
                disabled={!tabStripState.canScrollRight}
              >
                <ChevronRight className="size-3.5" />
              </button>
            )}
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
            ) : activeTerminal.status === "disconnected" ? (
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-orange-400">
                [disconnected]
              </span>
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

      {agentInfo && <AgentInfoBar agent={agentInfo} beat={beatInfoForBar} />}

      <div ref={termContainerRef} className="flex-1 overflow-hidden px-1 py-1" />
    </div>
  );
}
