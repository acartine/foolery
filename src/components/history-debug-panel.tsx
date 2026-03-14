"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, Loader2, TerminalSquare } from "lucide-react";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AgentHistorySession } from "@/lib/agent-history-types";
import { connectToSession, startSession } from "@/lib/terminal-api";
import type { TerminalEvent, TerminalSession } from "@/lib/types";
import { cn } from "@/lib/utils";

type DebugSessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "aborted"
  | "disconnected";

export interface HistoryDebugPromptInput {
  session: AgentHistorySession;
  expectedOutcome: string;
  actualOutcome: string;
}

export interface HistoryDebugPanelProps {
  beatId: string;
  session: AgentHistorySession;
  repoPath?: string;
  beatTitle?: string;
  className?: string;
  defaultExpectedOutcome?: string;
  defaultActualOutcome?: string;
  promptBuilder?: (input: HistoryDebugPromptInput) => string;
  onSessionStarted?: (session: TerminalSession) => void;
}

export function validateHistoryDebugForm(
  expectedOutcome: string,
  actualOutcome: string,
): string | null {
  if (!expectedOutcome.trim()) return "Expected Outcome is required.";
  if (!actualOutcome.trim()) return "Actual Outcome is required.";
  return null;
}

export function buildFallbackHistoryDebugPrompt({
  session,
  expectedOutcome,
  actualOutcome,
}: HistoryDebugPromptInput): string {
  return [
    "Investigate this Foolery history session.",
    "",
    "Expected Outcome",
    expectedOutcome.trim(),
    "",
    "Actual Outcome",
    actualOutcome.trim(),
    "",
    "Context",
    `- Session ID: ${session.sessionId}`,
    `- Interaction Type: ${session.interactionType}`,
    `- Repo Path: ${session.repoPath}`,
    `- Beat IDs: ${session.beatIds.join(", ") || "(none)"}`,
    "",
    "Explain why the actual outcome happened instead of the expected outcome.",
    "Ground the answer in the session context, call out any missing information, and offer concrete fix options the user could convert into knots after approval.",
  ].join("\n");
}

function appendEventToTerminal(term: XtermTerminal, event: TerminalEvent): void {
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
      const parsed = JSON.parse(event.data) as Record<string, unknown>;
      const nextAgent = typeof parsed.agentName === "string" ? parsed.agentName : "agent";
      term.writeln(`\r\n\x1b[36m↻ Agent switched to ${nextAgent}\x1b[0m`);
    } catch {
      term.writeln("\r\n\x1b[36m↻ Agent switched\x1b[0m");
    }
    return;
  }
  if (event.type === "exit") {
    const code = Number.parseInt(event.data, 10);
    if (code === 0) {
      term.writeln("\r\n\x1b[32m✓ Debug session completed successfully\x1b[0m");
    } else if (code === -2) {
      term.writeln("\r\n\x1b[33m⚠ Debug session disconnected\x1b[0m");
    } else {
      term.writeln(`\r\n\x1b[31m✗ Debug session exited with code ${code}\x1b[0m`);
    }
  }
}

function nextStatusForExitCode(code: number): DebugSessionStatus {
  if (code === 0) return "completed";
  if (code === -2) return "disconnected";
  if (code === 130) return "aborted";
  return "error";
}

function statusLabel(status: DebugSessionStatus): string {
  if (status === "idle") return "Idle";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "aborted") return "Aborted";
  if (status === "disconnected") return "Disconnected";
  return "Error";
}

function statusTone(status: DebugSessionStatus): string {
  if (status === "running") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (status === "completed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "aborted") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "disconnected") return "border-orange-500/30 bg-orange-500/10 text-orange-200";
  if (status === "error") return "border-red-500/30 bg-red-500/10 text-red-200";
  return "border-white/10 bg-white/5 text-white/70";
}

export function HistoryDebugPanel({
  beatId,
  session,
  repoPath,
  beatTitle,
  className,
  defaultExpectedOutcome = "",
  defaultActualOutcome = "",
  promptBuilder,
  onSessionStarted,
}: HistoryDebugPanelProps) {
  const [expectedOutcome, setExpectedOutcome] = useState(defaultExpectedOutcome);
  const [actualOutcome, setActualOutcome] = useState(defaultActualOutcome);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [debugSession, setDebugSession] = useState<TerminalSession | null>(null);
  const [debugStatus, setDebugStatus] = useState<DebugSessionStatus>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<XtermFitAddon | null>(null);
  const bufferRef = useRef<TerminalEvent[]>([]);

  const buildPrompt = promptBuilder ?? buildFallbackHistoryDebugPrompt;
  const resolvedRepoPath = repoPath ?? session.repoPath;
  const statusText = useMemo(() => statusLabel(debugStatus), [debugStatus]);

  const resetTerminalBuffer = useCallback(() => {
    bufferRef.current = [];
    termRef.current?.clear();
  }, []);

  const handleSubmit = useCallback(async () => {
    const validationError = validateHistoryDebugForm(
      expectedOutcome,
      actualOutcome,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setExitCode(null);
    setDebugStatus("running");
    resetTerminalBuffer();

    const prompt = buildPrompt({
      session,
      expectedOutcome,
      actualOutcome,
    });
    const result = await startSession(beatId, resolvedRepoPath, prompt);
    if (!result.ok || !result.data) {
      setDebugStatus("error");
      setError(result.error ?? "Failed to start debug session.");
      setIsSubmitting(false);
      return;
    }

    setDebugSession(result.data);
    onSessionStarted?.(result.data);
    setIsSubmitting(false);
  }, [
    actualOutcome,
    beatId,
    buildPrompt,
    expectedOutcome,
    onSessionStarted,
    resetTerminalBuffer,
    resolvedRepoPath,
    session,
  ]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container || !debugSession) return;

    let disposed = false;
    let unsubscribe = () => {};
    let term: XtermTerminal | null = null;

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

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
        convertEol: true,
        fontSize: 12,
        fontFamily: "var(--font-ibm-plex-mono), monospace",
        theme: {
          background: "#101522",
          foreground: "#d5def0",
          cursor: "#d5def0",
          red: "#ff7b72",
          green: "#7ee787",
          yellow: "#f2cc60",
          blue: "#79c0ff",
        },
        scrollback: 4_000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();
      term.focus();
      term.writeln(`\x1b[36m▶ History Debug Session: ${debugSession.id}\x1b[0m`);
      term.writeln(`\x1b[90m  Beat: ${beatId}${beatTitle ? ` — ${beatTitle}` : ""}\x1b[0m`);
      term.writeln("");

      termRef.current = term;
      fitRef.current = fitAddon;

      for (const event of bufferRef.current) {
        appendEventToTerminal(term, event);
      }

      unsubscribe = connectToSession(debugSession.id, (event) => {
        bufferRef.current.push(event);
        if (bufferRef.current.length > 2_000) {
          bufferRef.current = bufferRef.current.slice(-2_000);
        }
        if (event.type === "exit") {
          const code = Number.parseInt(event.data, 10);
          setExitCode(Number.isFinite(code) ? code : null);
          setDebugStatus(nextStatusForExitCode(code));
        }
        appendEventToTerminal(term!, event);
      });
    };

    void init();

    const handleResize = () => fitRef.current?.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("resize", handleResize);
      term?.dispose();
      if (termRef.current === term) termRef.current = null;
      fitRef.current = null;
    };
  }, [beatId, beatTitle, debugSession]);

  return (
    <section
      className={cn(
        "flex h-full min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101522] text-white shadow-[0_20px_80px_rgba(4,10,24,0.45)]",
        className,
      )}
    >
      <header className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(36,52,89,0.95),rgba(13,20,35,0.98))] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/80">
              <TerminalSquare className="size-4" />
              History Debugger
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold text-white">
              {beatTitle ?? beatId}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Launch an isolated debugging session from this conversation and inspect the result inline.
            </p>
          </div>
          <div
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              statusTone(debugStatus),
            )}
          >
            {statusText}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <div className="border-b border-white/10 bg-white/[0.03] p-5 lg:border-b-0 lg:border-r">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="history-debug-expected">Expected Outcome</Label>
              <Textarea
                id="history-debug-expected"
                value={expectedOutcome}
                onChange={(event) => setExpectedOutcome(event.target.value)}
                placeholder="What should have happened?"
                className="min-h-24 border-white/10 bg-black/10 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="history-debug-actual">Actual Outcome</Label>
              <Textarea
                id="history-debug-actual"
                value={actualOutcome}
                onChange={(event) => setActualOutcome(event.target.value)}
                placeholder="What happened instead?"
                className="min-h-24 border-white/10 bg-black/10 text-white placeholder:text-slate-500"
              />
            </div>
            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Debug
            </Button>
            <dl className="space-y-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <dt>Conversation</dt>
                <dd className="truncate text-right text-white">{session.sessionId}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Interaction</dt>
                <dd className="text-white">{session.interactionType}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Beats</dt>
                <dd className="truncate text-right text-white">
                  {session.beatIds.join(", ") || "(none)"}
                </dd>
              </div>
              {debugSession ? (
                <div className="flex items-center justify-between gap-3">
                  <dt>Debug Session</dt>
                  <dd className="truncate text-right text-white">{debugSession.id}</dd>
                </div>
              ) : null}
              {exitCode !== null ? (
                <div className="flex items-center justify-between gap-3">
                  <dt>Exit Code</dt>
                  <dd className="text-white">{exitCode}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>

        <div className="flex min-h-[20rem] flex-col bg-[#0b1020]">
          <div className="border-b border-white/10 px-4 py-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
            Embedded Terminal
          </div>
          <div className="relative min-h-0 flex-1">
            {!debugSession ? (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-400">
                Submit the form to open a dedicated debug terminal for this conversation.
              </div>
            ) : null}
            <div
              ref={terminalContainerRef}
              className={cn(
                "h-full min-h-[20rem] w-full p-3 font-mono text-xs",
                debugSession ? "opacity-100" : "opacity-30",
              )}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
