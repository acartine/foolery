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
}) {
  return (
    <div className="border-b border-white/10 bg-white/[0.03] p-5 lg:border-b-0 lg:border-r">
      <div className="space-y-5">
        <OutcomeField
          id="history-debug-expected"
          label="Expected Outcome"
          value={expectedOutcome}
          onChange={setExpectedOutcome}
          placeholder="What should have happened?"
        />
        <OutcomeField
          id="history-debug-actual"
          label="Actual Outcome"
          value={actualOutcome}
          onChange={setActualOutcome}
          placeholder="What happened instead?"
        />
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
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Debug
        </Button>
        <SessionInfoDl
          session={session}
          debugSession={debugSession}
          exitCode={exitCode}
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-24 border-white/10 bg-black/10 text-white placeholder:text-slate-500"
      />
    </div>
  );
}

function SessionInfoDl({
  session,
  debugSession,
  exitCode,
}: {
  session: AgentHistorySession;
  debugSession: TerminalSession | null;
  exitCode: number | null;
}) {
  return (
    <dl className="space-y-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300">
      <InfoRow
        label="Conversation"
        value={session.sessionId}
        truncate
      />
      <InfoRow
        label="Interaction"
        value={session.interactionType}
      />
      <InfoRow
        label="Beats"
        value={session.beatIds.join(", ") || "(none)"}
        truncate
      />
      {debugSession ? (
        <InfoRow
          label="Debug Session"
          value={debugSession.id}
          truncate
        />
      ) : null}
      {exitCode !== null ? (
        <InfoRow
          label="Exit Code"
          value={String(exitCode)}
        />
      ) : null}
    </dl>
  );
}

function InfoRow({
  label,
  value,
  truncate,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd
        className={cn(
          "text-right text-white",
          truncate && "truncate",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
