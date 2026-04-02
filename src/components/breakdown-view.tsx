"use client";

import React, {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  useRouter, useSearchParams,
} from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Copy, Loader2,
  Square, Workflow, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  abortBreakdown,
  connectToBreakdown, startBreakdown,
} from "@/lib/breakdown-api";
import { useWaitSpinner } from "@/hooks/use-wait-spinner";
import { useAppStore } from "@/stores/app-store";
import {
  useApplyBreakdown,
  useBreakdownBack,
} from "@/components/breakdown-view-actions";
import type {
  BreakdownEvent, BreakdownPlan,
  BreakdownSession,
} from "@/lib/types";

type Status = BreakdownSession["status"] | "idle";
type SetState<T> = React.Dispatch<
  React.SetStateAction<T>>;
const MAX_LOG_LINES = 500;

function isPlanPayload(
  value: unknown,
): value is BreakdownPlan {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.summary === "string"
    && Array.isArray(obj.waves);
}

function statusTone(s: Status) {
  if (s === "running")
    return "bg-blue-100 text-blue-700 border-blue-200";
  if (s === "completed")
    return "bg-green-100 text-green-700 border-green-200";
  if (s === "error")
    return "bg-red-100 text-red-700 border-red-200";
  if (s === "aborted")
    return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

function logText(d: unknown): string {
  return typeof d === "string"
    ? d : JSON.stringify(d);
}

/* --- Sub-components ----------------------------- */

function NoParentMessage() {
  return (
    <div className={
      "rounded-xl border border-dashed p-6 "
      + "text-sm text-muted-foreground"
    }>
      No parent beat specified. Go back to the
      beats list and use Breakdown from the create
      dialog.
    </div>
  );
}

interface HeaderProps {
  status: Status; isRunning: boolean;
  canApply: boolean; isApplying: boolean;
  onAbort: () => void; onApply: () => void;
  onBack: () => void;
}

function BreakdownHeader(p: HeaderProps) {
  return (
    <section className={
      "rounded-2xl border bg-gradient-to-br "
      + "from-violet-50 via-purple-50 "
      + "to-indigo-50 p-4"
    }>
      <div className={
        "flex flex-wrap items-center "
        + "justify-between gap-2"
      }>
        <div>
          <h2 className={
            "text-base font-semibold tracking-tight "
            + "flex items-center gap-1.5"
          }>
            <Zap className="size-4" /> Breakdown
          </h2>
          <p className="text-sm text-muted-foreground">
            Decomposing beat into implementation tasks...
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={
            `${statusTone(p.status)} `
            + "border px-2 py-0.5 text-xs"
          }>
            {p.status}
          </Badge>
          {p.isRunning && (
            <Button size="sm" variant="destructive"
              className="gap-1.5"
              title="Abort the breakdown session"
              onClick={p.onAbort}>
              <Square className="size-3.5" /> Abort
            </Button>
          )}
          {p.canApply && (
            <Button size="sm" className="gap-1.5"
              title="Create all beats from the plan"
              onClick={p.onApply}
              disabled={p.isApplying}>
              {p.isApplying
                ? <Loader2
                  className="size-3.5 animate-spin" />
                : <CheckCircle2
                  className="size-3.5" />}
              LGTM — Create Beats
            </Button>
          )}
          <Button size="sm" variant="outline"
            className="gap-1.5"
            title="Return to the beats list"
            onClick={p.onBack}>
            Back to List
          </Button>
        </div>
      </div>
    </section>
  );
}

function WaveCard({ wave }: {
  wave: BreakdownPlan["waves"][number];
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="outline"
          className="font-mono text-[11px]">
          Scene {wave.waveIndex}
        </Badge>
        <span className="text-sm font-semibold">
          {wave.name}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        {wave.objective}
      </p>
      <div className="space-y-1">
        {wave.beats.map((beat, i) => (
          <div key={i} className={
            "rounded-md border bg-white/90 px-2.5 "
            + "py-1.5 text-xs flex items-center gap-2"
          }>
            <Badge variant="outline"
              className="h-5 px-1.5 text-[10px]">
              {beat.type}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              P{beat.priority}
            </span>
            <span className="font-medium">
              {beat.title}
            </span>
          </div>
        ))}
      </div>
      {wave.notes && (
        <p className={
          "mt-2 text-[11px] "
          + "text-muted-foreground italic"
        }>
          {wave.notes}
        </p>
      )}
    </div>
  );
}

function ScenePlan(
  { plan }: { plan: BreakdownPlan },
) {
  const total = plan.waves.reduce(
    (s, w) => s + w.beats.length, 0,
  );
  const lbl = plan.waves.length === 1
    ? "scene" : "scenes";
  return (
    <section className="space-y-3">
      <h3 className={
        "text-sm font-semibold flex items-center gap-1.5"
      }>
        <Workflow className="size-4" />
        Scene Plan — {plan.waves.length} {lbl},{" "}
        {total} beats
      </h3>
      <p className="text-xs text-muted-foreground">
        {plan.summary}
      </p>
      {plan.waves.map((w) => (
        <WaveCard key={w.waveIndex} wave={w} />
      ))}
      {plan.assumptions.length > 0 && (
        <div className={
          "rounded-lg border bg-yellow-50/50 p-3"
        }>
          <p className={
            "text-xs font-semibold "
            + "text-yellow-800 mb-1"
          }>
            Assumptions
          </p>
          <ul className={
            "list-disc pl-4 text-xs "
            + "text-yellow-700 space-y-0.5"
          }>
            {plan.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ConsolePanel({ logLines, logRef, isRunning,
  isWaiting, spinner, waitText,
}: {
  logLines: string[];
  logRef: React.RefObject<HTMLDivElement | null>;
  isRunning: boolean; isWaiting: boolean;
  spinner: string; waitText: string;
}) {
  return (
    <section className={
      "rounded-xl border bg-zinc-950 p-3"
    }>
      <div className={
        "flex items-center justify-between mb-2"
      }>
        <p className="text-xs text-zinc-400 font-mono">
          Console
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" className={
            "rounded p-0.5 text-zinc-400 "
            + "hover:bg-zinc-800 hover:text-zinc-200"
          } title="Copy console output" onClick={() => {
            navigator.clipboard.writeText(
              logLines.join("\n"),
            );
            toast.success("Copied console output");
          }}>
            <Copy className="size-3.5" />
          </button>
          {isWaiting && (
            <span className={
              "text-[10px] text-sky-300 "
              + "motion-safe:animate-pulse"
            }>
              {spinner}
            </span>
          )}
          {isRunning && (
            <Loader2 className={
              "size-3 animate-spin text-zinc-400"
            } />
          )}
        </div>
      </div>
      <div ref={logRef} className={
        "max-h-60 overflow-y-auto font-mono "
        + "text-[11px] text-zinc-300 "
        + "whitespace-pre-wrap"
      }>
        {logLines.length === 0 ? (
          <span className={isRunning
            ? "text-sky-300 motion-safe:animate-pulse"
            : "text-zinc-500"
          }>
            {isRunning ? waitText
              : "Waiting for output..."}
          </span>
        ) : logLines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </section>
  );
}

/* --- Main component ----------------------------- */

export function BreakdownView() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { activeRepo } = useAppStore();
  const parentBeatId = sp.get("parent") ?? "";
  const [session, setSession] =
    useState<BreakdownSession | null>(null);
  const [plan, setPlan] =
    useState<BreakdownPlan | null>(null);
  const [logLines, setLogLines] =
    useState<string[]>([]);
  const [isApplying, setIsApplying] =
    useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const cleanupRef =
    useRef<(() => void) | null>(null);
  const appendLog = useCallback((t: string) => {
    setLogLines((prev) => {
      const next = [...prev, t];
      return next.length > MAX_LOG_LINES
        ? next.slice(-MAX_LOG_LINES) : next;
    });
  }, []);
  const handleEvent = useCallback(
    (ev: BreakdownEvent) => {
      dispatch(ev, setPlan, appendLog, setSession);
    }, [appendLog],
  );
  useLifecycle(
    activeRepo, parentBeatId, startedRef,
    cleanupRef, setSession, handleEvent, appendLog,
  );
  useEffect(() => {
    if (logRef.current)
      logRef.current.scrollTop =
        logRef.current.scrollHeight;
  }, [logLines]);
  const handleAbort = useAbort(session, setSession);
  const handleApply = useApplyBreakdown(
    session, plan, activeRepo, qc,
    sp, router, parentBeatId, setIsApplying,
  );
  const handleBack = useBreakdownBack(sp, router);
  const status: Status = session?.status ?? "idle";
  const isRunning = status === "running";
  const isWaiting = isRunning && !logLines.length;
  const spinner = useWaitSpinner({
    enabled: isWaiting,
  });
  const waitText =
    `Waiting on agent | ${spinner}`;
  const canApply = status === "completed"
    && !!plan && plan.waves.length > 0
    && !isApplying;
  if (!parentBeatId) return <NoParentMessage />;
  return (
    <div className="space-y-4 pb-4">
      <BreakdownHeader
        status={status} isRunning={isRunning}
        canApply={canApply} isApplying={isApplying}
        onAbort={handleAbort} onApply={handleApply}
        onBack={handleBack}
      />
      {plan && plan.waves.length > 0 && (
        <ScenePlan plan={plan} />
      )}
      <ConsolePanel
        logLines={logLines} logRef={logRef}
        isRunning={isRunning} isWaiting={isWaiting}
        spinner={spinner} waitText={waitText}
      />
    </div>
  );
}

/* --- Extracted hooks & helpers ------------------ */

function dispatch(
  event: BreakdownEvent,
  setPlan: SetState<BreakdownPlan | null>,
  appendLog: (t: string) => void,
  setSession: SetState<BreakdownSession | null>,
) {
  if (event.type === "plan"
    && isPlanPayload(event.data)) {
    setPlan(event.data);
  } else if (
    event.type === "status"
    || event.type === "error"
  ) {
    appendLog(logText(event.data));
    if (event.type === "error") {
      setSession((prev) => prev ? {
        ...prev, status: "error" as const,
        error: logText(event.data),
      } : prev);
    }
  } else if (event.type === "log") {
    appendLog(logText(event.data));
  } else if (event.type === "exit") {
    setSession((prev) => {
      if (!prev || prev.status !== "running")
        return prev;
      return { ...prev, status: "completed" };
    });
  }
}

function useLifecycle(
  activeRepo: string | null,
  parentBeatId: string,
  startedRef: React.MutableRefObject<boolean>,
  cleanupRef: React.MutableRefObject<
    (() => void) | null>,
  setSession: SetState<BreakdownSession | null>,
  handleEvent: (e: BreakdownEvent) => void,
  appendLog: (t: string) => void,
) {
  useEffect(() => {
    if (!activeRepo || !parentBeatId
      || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const r = await startBreakdown(
        activeRepo, parentBeatId,
      );
      if (!r.ok || !r.data) {
        toast.error(
          r.error ?? "Failed to start breakdown",
        );
        return;
      }
      setSession(r.data);
      cleanupRef.current = connectToBreakdown(
        r.data.id, handleEvent,
        () => { appendLog("Connection lost"); },
      );
    })();
    return () => { cleanupRef.current?.(); };
  }, [
    activeRepo, parentBeatId, handleEvent,
    appendLog, startedRef, cleanupRef, setSession,
  ]);
}

function useAbort(
  session: BreakdownSession | null,
  setSession: SetState<BreakdownSession | null>,
) {
  return useCallback(async () => {
    if (!session) return;
    const r = await abortBreakdown(session.id);
    if (r.ok) {
      setSession((p) =>
        p ? { ...p, status: "aborted" } : p);
      toast.success("Breakdown aborted");
    } else {
      toast.error(r.error ?? "Failed to abort");
    }
  }, [session, setSession]);
}
