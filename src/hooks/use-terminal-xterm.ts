"use client";

import { useEffect, useRef } from "react";
import {
  useTerminalStore,
  type ActiveTerminal,
} from "@/stores/terminal-store";
import {
  sessionConnections,
} from "@/lib/session-connection-manager";
import type {
  TerminalFailureGuidance,
} from "@/lib/terminal-failure";
import {
  abortSession,
  startSession,
} from "@/lib/terminal-api";
import {
  writeExitMessage,
} from "@/components/terminal-exit-message";
import type {
  XtermTerminal,
  XtermFitAddon,
} from "@/components/terminal-exit-message";
import { toast } from "sonner";
import { getTerminalTheme } from "@/lib/terminal-theme";

interface XtermHookParams {
  panelOpen: boolean;
  activeSessionKey: string | null;
  activeBeatId: string | null;
  activeBeatTitle: string | null;
  activeRepoPath: string | undefined;
  removeTerminal: (sid: string) => void;
  upsertTerminal: (t: ActiveTerminal) => void;
  agentCommand: string | undefined;
  thinkingDetailVisible: boolean;
  lightTheme: boolean;
  recentOutputBySession: React.RefObject<
    Map<string, string>
  >;
  failureHintBySession: React.RefObject<
    Map<string, TerminalFailureGuidance>
  >;
}

interface XtermHookResult {
  termContainerRef: React.RefObject<
    HTMLDivElement | null
  >;
  termRef: React.RefObject<
    XtermTerminal | null
  >;
  fitRef: React.RefObject<
    XtermFitAddon | null
  >;
  handleAbort: () => Promise<void>;
}

/**
 * Manages xterm lifecycle and session
 * connection subscriptions.
 */
export function useTerminalXterm(
  params: XtermHookParams,
): XtermHookResult {
  const containerRef =
    useRef<HTMLDivElement>(null);
  const termRef =
    useRef<XtermTerminal | null>(null);
  const fitRef =
    useRef<XtermFitAddon | null>(null);
  const cleanupRef =
    useRef<(() => void) | null>(null);

  useXtermEffect(
    params, containerRef,
    termRef, fitRef, cleanupRef,
  );

  useEffect(() => {
    if (!params.panelOpen || !fitRef.current) {
      return;
    }
    const t = setTimeout(
      () => fitRef.current?.fit(), 100,
    );
    return () => clearTimeout(t);
  }, [params.panelOpen]);

  const handleAbort = async () => {
    if (!params.activeSessionKey) return;
    await abortSession(params.activeSessionKey);
    useTerminalStore.getState().updateStatus(
      params.activeSessionKey, "aborted",
    );
  };

  return {
    termContainerRef: containerRef,
    termRef, fitRef, handleAbort,
  };
}

/* ---- Effect ---- */

function useXtermEffect(
  p: XtermHookParams,
  containerRef: React.RefObject<
    HTMLDivElement | null
  >,
  termRef: React.RefObject<
    XtermTerminal | null
  >,
  fitRef: React.RefObject<
    XtermFitAddon | null
  >,
  cleanupRef: React.RefObject<
    (() => void) | null
  >,
) {
  useEffect(() => {
    if (
      !p.panelOpen
      || !p.activeSessionKey
      || !p.activeBeatId
      || !p.activeBeatTitle
      || !containerRef.current
    ) return;

    const sid = p.activeSessionKey;
    const beatId = p.activeBeatId;
    const beatTitle = p.activeBeatTitle;
    let term: XtermTerminal | null = null;
    const disposed = { value: false };

    const init = async () => {
      term = await createAndMount(
        containerRef, disposed, p.lightTheme,
      );
      if (!term) return;
      termRef.current = term;
      fitRef.current = (
        term as unknown as { _fitAddon: XtermFitAddon }
      )._fitAddon;

      writeBanner(term, beatId, beatTitle);
      const unsub = connectSession(
        term, sid, beatId, disposed, p,
      );
      cleanupRef.current = unsub;
    };
    void init();

    return () => {
      disposed.value = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (term) {
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      }
    };
  }, [
    p, containerRef, termRef, fitRef, cleanupRef,
  ]);
}

/* ---- Helpers ---- */

async function createAndMount(
  containerRef: React.RefObject<
    HTMLDivElement | null
  >,
  disposed: { value: boolean },
  lightTheme: boolean,
): Promise<XtermTerminal | null> {
  const { Terminal } =
    await import("@xterm/xterm");
  const { FitAddon } =
    await import("@xterm/addon-fit");
  ensureXtermCss();
  if (disposed.value) return null;

  const term = createXtermInstance(Terminal, lightTheme);
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(containerRef.current!);
  fitAddon.fit();
  // Stash fitAddon on the term for retrieval
  (
    term as unknown as { _fitAddon: XtermFitAddon }
  )._fitAddon = fitAddon;
  return term;
}

function ensureXtermCss() {
  if (!document.querySelector(
    'link[href*="xterm"]',
  )) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/xterm.css";
    document.head.appendChild(link);
  }
}

function writeBanner(
  term: XtermTerminal,
  beatId: string,
  beatTitle: string,
) {
  term.writeln(
    `\x1b[36m\u25b6 Rolling beat:`
    + ` ${beatId}\x1b[0m`,
  );
  term.writeln(
    `\x1b[90m  ${beatTitle}\x1b[0m`,
  );
  term.writeln("");
}

function connectSession(
  liveTerm: XtermTerminal,
  sessionId: string,
  beatId: string,
  disposed: { value: boolean },
  p: XtermHookParams,
): () => void {
  const recoveryFlag = { inFlight: false };
  const doRecovery = (
    prev: string | null,
  ) => void launchRecovery(
    beatId, sessionId,
    p.activeRepoPath, liveTerm,
    disposed, p.upsertTerminal,
    p.removeTerminal, recoveryFlag, prev,
  );

  const write = (type: string, data: string) =>
    writeTerminalEvent(
      liveTerm, type, data, sessionId,
      p.thinkingDetailVisible,
      p.recentOutputBySession,
      p.failureHintBySession,
      p.agentCommand, doRecovery,
    );

  const buf =
    sessionConnections.getBuffer(sessionId);
  for (const e of buf) write(e.type, e.data);

  if (
    sessionConnections.hasExited(sessionId)
    && !buf.some((e) => e.type === "exit")
  ) {
    const code =
      sessionConnections.getExitCode(sessionId)
      ?? 0;
    writeExitMessage(
      liveTerm, code, sessionId,
      p.recentOutputBySession,
      p.failureHintBySession,
      p.agentCommand, doRecovery,
    );
  }

  return sessionConnections.subscribe(
    sessionId, (ev) => {
      if (disposed.value) return;
      write(ev.type, ev.data);
    },
  );
}

function appendRecentOutput(
  ref: React.RefObject<Map<string, string>>,
  sid: string,
  chunk: string,
): void {
  if (!chunk) return;
  const prev = ref.current.get(sid) ?? "";
  const combined = prev + chunk;
  ref.current.set(
    sid,
    combined.length > 16_000
      ? combined.slice(-16_000)
      : combined,
  );
}

function writeTerminalEvent(
  term: XtermTerminal,
  type: string,
  data: string,
  sid: string,
  detailVisible: boolean,
  outputRef: React.RefObject<
    Map<string, string>
  >,
  hintRef: React.RefObject<
    Map<string, TerminalFailureGuidance>
  >,
  agentCmd: string | undefined,
  recovery: (prev: string | null) => void,
): void {
  if (type === "stdout") {
    appendRecentOutput(outputRef, sid, data);
    term.write(data);
  } else if (type === "stdout_detail") {
    appendRecentOutput(outputRef, sid, data);
    if (detailVisible) term.write(data);
  } else if (type === "stderr") {
    appendRecentOutput(outputRef, sid, data);
    if (detailVisible) {
      term.write(`\x1b[31m${data}\x1b[0m`);
    }
  } else if (type === "exit") {
    writeExitMessage(
      term, parseInt(data, 10), sid,
      outputRef, hintRef,
      agentCmd, recovery,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createXtermInstance(Terminal: any, lightTheme: boolean) {
  return new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontSize: 13,
    fontFamily:
      "var(--font-ibm-plex-mono), monospace",
    theme: getTerminalTheme(lightTheme),
    convertEol: true,
    scrollback: 5000,
  });
}

function buildTakeRecoveryPrompt(
  beatId: string,
  prevSid: string | null,
): string {
  return [
    `Take recovery for beat ${beatId}.`,
    prevSid
      ? `Prior agent session id: ${prevSid}.`
      : "No prior agent session id was"
        + " captured from the failed run.",
    "The previous run failed during a"
      + " follow-up after primary work"
      + " completed.",
    "Use current repository state and"
      + " avoid redoing completed changes.",
    "Confirm merge/push state and apply"
      + " the profile transition command"
      + " (or Knots claim completion command)"
      + " for this beat if not already applied.",
    "Finish with a concise summary: merged"
      + " yes/no, pushed yes/no,"
      + " transition/claim completion"
      + " command result.",
  ].join("\n");
}

async function launchRecovery(
  beatId: string,
  sessionId: string,
  repoPath: string | undefined,
  liveTerm: XtermTerminal,
  disposed: { value: boolean },
  upsert: (t: ActiveTerminal) => void,
  remove: (sid: string) => void,
  flag: { inFlight: boolean },
  prevSid: string | null,
): Promise<void> {
  if (flag.inFlight) return;
  flag.inFlight = true;
  liveTerm.writeln(
    "\x1b[33m\u21bb Retrying take"
    + " with recovery prompt...\x1b[0m",
  );
  const r = await startSession(
    beatId, repoPath,
    buildTakeRecoveryPrompt(beatId, prevSid),
  );
  if (disposed.value) return;
  if (!r.ok || !r.data) {
    liveTerm.writeln(
      "\x1b[31m\u2717 Recovery launch failed: "
      + `${r.error ?? "unknown error"}\x1b[0m`,
    );
    useTerminalStore.getState()
      .updateStatus(sessionId, "error");
    toast.error(
      r.error
      ?? "Failed to launch recovery session",
    );
    flag.inFlight = false;
    return;
  }
  upsert({
    sessionId: r.data.id,
    beatId: r.data.beatId,
    beatTitle: r.data.beatTitle,
    repoPath: r.data.repoPath ?? repoPath,
    agentName: r.data.agentName,
    agentModel: r.data.agentModel,
    agentVersion: r.data.agentVersion,
    agentCommand: r.data.agentCommand,
    status: "running",
    startedAt: r.data.startedAt,
  });
  remove(sessionId);
  toast.info(
    "Retry launched with recovery prompt.",
  );
}
