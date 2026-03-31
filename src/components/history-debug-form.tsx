"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AgentHistorySession } from "@/lib/agent-history-types";
import type { TerminalSession } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DebugFormPanel({
  expectedOutcome,
  setExpectedOutcome,
  actualOutcome,
  setActualOutcome,
  error,
  isSubmitting,
  handleSubmit,
  session,
  debugSession,
  exitCode,
  lightTheme,
}: {
  expectedOutcome: string;
  setExpectedOutcome: (v: string) => void;
  actualOutcome: string;
  setActualOutcome: (v: string) => void;
  error: string | null;
  isSubmitting: boolean;
  handleSubmit: () => Promise<void>;
  session: AgentHistorySession;
  debugSession: TerminalSession | null;
  exitCode: number | null;
  lightTheme: boolean;
}) {
  const panelClass = lightTheme
    ? "border-slate-200 bg-white/80 text-slate-900"
    : "border-white/10 bg-white/[0.03] text-white";
  const errorClass = lightTheme
    ? "border-red-300 bg-red-50 text-red-700"
    : "border-red-500/30 bg-red-500/10 text-red-200";

  return (
    <div className={cn(
      "border-b p-5 lg:border-b-0 lg:border-r",
      panelClass,
    )}>
      <div className="space-y-5">
        <OutcomeField
          id="history-debug-expected"
          label="Expected Outcome"
          value={expectedOutcome}
          onChange={setExpectedOutcome}
          placeholder="What should have happened?"
          lightTheme={lightTheme}
        />
        <OutcomeField
          id="history-debug-actual"
          label="Actual Outcome"
          value={actualOutcome}
          onChange={setActualOutcome}
          placeholder="What happened instead?"
          lightTheme={lightTheme}
        />
        {error ? (
          <div className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2 text-sm",
            errorClass,
          )}>
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
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Debug
        </Button>
        <SessionInfoDl
          session={session}
          debugSession={debugSession}
          exitCode={exitCode}
          lightTheme={lightTheme}
        />
      </div>
    </div>
  );
}

function OutcomeField({
  id,
  label,
  value,
  onChange,
  placeholder,
  lightTheme,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  lightTheme: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "min-h-24",
          lightTheme
            ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"
            : "border-white/10 bg-black/10 text-white placeholder:text-slate-500",
        )}
      />
    </div>
  );
}

function SessionInfoDl({
  session,
  debugSession,
  exitCode,
  lightTheme,
}: {
  session: AgentHistorySession;
  debugSession: TerminalSession | null;
  exitCode: number | null;
  lightTheme: boolean;
}) {
  return (
    <dl className={cn(
      "space-y-2 rounded-xl border px-3 py-3 text-sm",
      lightTheme
        ? "border-slate-300 bg-slate-50 text-slate-600"
        : "border-white/10 bg-black/10 text-slate-300",
    )}>
      <InfoRow
        label="Conversation"
        value={session.sessionId}
        truncate
        lightTheme={lightTheme}
      />
      <InfoRow
        label="Interaction"
        value={session.interactionType}
        lightTheme={lightTheme}
      />
      <InfoRow
        label="Beats"
        value={session.beatIds.join(", ") || "(none)"}
        truncate
        lightTheme={lightTheme}
      />
      {debugSession ? (
        <InfoRow
          label="Debug Session"
          value={debugSession.id}
          truncate
          lightTheme={lightTheme}
        />
      ) : null}
      {exitCode !== null ? (
        <InfoRow
          label="Exit Code"
          value={String(exitCode)}
          lightTheme={lightTheme}
        />
      ) : null}
    </dl>
  );
}

function InfoRow({
  label,
  value,
  truncate,
  lightTheme,
}: {
  label: string;
  value: string;
  truncate?: boolean;
  lightTheme: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd
        className={cn(
          "text-right",
          lightTheme ? "text-slate-900" : "text-white",
          truncate && "truncate",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
