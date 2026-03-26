"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { AgentHistorySession } from "@/lib/agent-history-types";
import { startSession } from "@/lib/terminal-api";
import type {
  BdResult,
  TerminalEvent,
  TerminalSession,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DebugPanelHeader,
  DebugTerminalPanel,
  useTerminalEffect,
} from "@/components/history-debug-sub";
import { DebugFormPanel } from "@/components/history-debug-form";

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
  promptBuilder?: (
    input: HistoryDebugPromptInput,
  ) => string;
  onSessionStarted?: (
    session: TerminalSession,
  ) => void;
}

export function validateHistoryDebugForm(
  expectedOutcome: string,
  actualOutcome: string,
): string | null {
  if (!expectedOutcome.trim())
    return "Expected Outcome is required.";
  if (!actualOutcome.trim())
    return "Actual Outcome is required.";
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
    "Explain why the actual outcome happened" +
      " instead of the expected outcome.",
    "Ground the answer in the session context," +
      " call out any missing information, and" +
      " offer concrete fix options the user" +
      " could convert into knots after approval.",
  ].join("\n");
}

export async function launchHistoryDebugSession(
  beatId: string,
  repoPath: string | undefined,
  prompt: string,
  startSessionFn: typeof startSession = startSession,
): Promise<BdResult<TerminalSession>> {
  try {
    return await startSessionFn(
      beatId,
      repoPath,
      prompt,
    );
  } catch (error) {
    const detail =
      error instanceof Error &&
      error.message.trim()
        ? ` ${error.message.trim()}`
        : "";
    return {
      ok: false,
      error:
        "Failed to start debug session." +
        " Check the terminal service" +
        ` and try again.${detail}`,
    };
  }
}

function statusLabel(
  status: DebugSessionStatus,
): string {
  if (status === "idle") return "Idle";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "aborted") return "Aborted";
  if (status === "disconnected")
    return "Disconnected";
  return "Error";
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
  const formState = useDebugFormState(
    defaultExpectedOutcome,
    defaultActualOutcome,
  );
  const sessionState = useDebugSessionState();

  const termRefs = useTerminalRefs();
  const buildPrompt = promptBuilder ?? buildFallbackHistoryDebugPrompt;
  const resolvedRepoPath = repoPath ?? session.repoPath;
  const statusText = useMemo(
    () => statusLabel(sessionState.debugStatus),
    [sessionState.debugStatus],
  );

  const handleSubmit = useSubmitHandler(
    formState,
    sessionState,
    termRefs.bufferRef,
    termRefs.termRef,
    buildPrompt,
    session,
    beatId,
    resolvedRepoPath,
    onSessionStarted,
  );

  useTerminalEffect(
    termRefs.containerRef,
    termRefs.termRef,
    termRefs.fitRef,
    termRefs.bufferRef,
    sessionState.debugSession,
    beatId,
    beatTitle,
    sessionState.setExitCode,
    sessionState.setDebugStatus,
  );

  return (
    <section
      className={cn(
        "flex h-full min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101522] text-white shadow-[0_20px_80px_rgba(4,10,24,0.45)]",
        className,
      )}
    >
      <DebugPanelHeader
        beatId={beatId}
        beatTitle={beatTitle}
        debugStatus={sessionState.debugStatus}
        statusText={statusText}
      />

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <DebugFormPanel
          expectedOutcome={
            formState.expectedOutcome
          }
          setExpectedOutcome={
            formState.setExpectedOutcome
          }
          actualOutcome={
            formState.actualOutcome
          }
          setActualOutcome={
            formState.setActualOutcome
          }
          error={formState.error}
          isSubmitting={formState.isSubmitting}
          handleSubmit={handleSubmit}
          session={session}
          debugSession={
            sessionState.debugSession
          }
          exitCode={sessionState.exitCode}
        />

        <DebugTerminalPanel
          debugSession={sessionState.debugSession}
          terminalContainerRef={termRefs.containerRef}
        />
      </div>
    </section>
  );
}

// ── Ref hooks ──

function useTerminalRefs() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<XtermFitAddon | null>(null);
  const bufferRef = useRef<TerminalEvent[]>([]);
  return { containerRef, termRef, fitRef, bufferRef };
}

// ── State hooks ──

function useDebugFormState(
  defaultExpected: string,
  defaultActual: string,
) {
  const [expectedOutcome, setExpectedOutcome] =
    useState(defaultExpected);
  const [actualOutcome, setActualOutcome] =
    useState(defaultActual);
  const [error, setError] = useState<
    string | null
  >(null);
  const [isSubmitting, setIsSubmitting] =
    useState(false);
  return {
    expectedOutcome,
    setExpectedOutcome,
    actualOutcome,
    setActualOutcome,
    error,
    setError,
    isSubmitting,
    setIsSubmitting,
  };
}

function useDebugSessionState() {
  const [debugSession, setDebugSession] =
    useState<TerminalSession | null>(null);
  const [debugStatus, setDebugStatus] =
    useState<DebugSessionStatus>("idle");
  const [exitCode, setExitCode] = useState<
    number | null
  >(null);
  return {
    debugSession,
    setDebugSession,
    debugStatus,
    setDebugStatus,
    exitCode,
    setExitCode,
  };
}

function useSubmitHandler(
  formState: ReturnType<typeof useDebugFormState>,
  sessionState: ReturnType<
    typeof useDebugSessionState
  >,
  bufferRef: React.MutableRefObject<
    TerminalEvent[]
  >,
  termRef: React.MutableRefObject<
    XtermTerminal | null
  >,
  buildPrompt: (
    input: HistoryDebugPromptInput,
  ) => string,
  session: AgentHistorySession,
  beatId: string,
  resolvedRepoPath: string,
  onSessionStarted:
    | ((s: TerminalSession) => void)
    | undefined,
) {
  return useCallback(async () => {
    const validationError =
      validateHistoryDebugForm(
        formState.expectedOutcome,
        formState.actualOutcome,
      );
    if (validationError) {
      formState.setError(validationError);
      return;
    }

    formState.setIsSubmitting(true);
    formState.setError(null);
    sessionState.setExitCode(null);
    sessionState.setDebugStatus("running");
    bufferRef.current = [];
    termRef.current?.clear();
    try {
      const prompt = buildPrompt({
        session,
        expectedOutcome:
          formState.expectedOutcome,
        actualOutcome: formState.actualOutcome,
      });
      const result =
        await launchHistoryDebugSession(
          beatId,
          resolvedRepoPath,
          prompt,
        );
      if (!result.ok || !result.data) {
        sessionState.setDebugStatus("error");
        formState.setError(
          result.error ??
            "Failed to start debug session.",
        );
        return;
      }
      sessionState.setDebugSession(result.data);
      onSessionStarted?.(result.data);
    } catch (err) {
      const message =
        err instanceof Error &&
        err.message.trim()
          ? err.message.trim()
          : "Failed to start debug session.";
      sessionState.setDebugStatus("error");
      formState.setError(message);
    } finally {
      formState.setIsSubmitting(false);
    }
  }, [
    beatId,
    bufferRef,
    buildPrompt,
    formState,
    onSessionStarted,
    resolvedRepoPath,
    session,
    sessionState,
    termRef,
  ]);
}
