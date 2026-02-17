"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Square,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  abortBreakdown,
  applyBreakdown,
  connectToBreakdown,
  startBreakdown,
} from "@/lib/breakdown-api";
import { useAppStore } from "@/stores/app-store";
import type {
  BreakdownEvent,
  BreakdownPlan,
  BreakdownSession,
} from "@/lib/types";

const MAX_LOG_LINES = 500;

function isPlanPayload(value: unknown): value is BreakdownPlan {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.summary === "string" && Array.isArray(obj.waves);
}

function statusTone(status: BreakdownSession["status"] | "idle") {
  if (status === "running") return "bg-blue-100 text-blue-700 border-blue-200";
  if (status === "completed") return "bg-green-100 text-green-700 border-green-200";
  if (status === "error") return "bg-red-100 text-red-700 border-red-200";
  if (status === "aborted") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

export function BreakdownView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { activeRepo } = useAppStore();

  const parentBeadId = searchParams.get("parent") ?? "";

  const [session, setSession] = useState<BreakdownSession | null>(null);
  const [plan, setPlan] = useState<BreakdownPlan | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const appendLog = useCallback((text: string) => {
    setLogLines((prev) => {
      const next = [...prev, text];
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
    });
  }, []);

  const handleEvent = useCallback(
    (event: BreakdownEvent) => {
      if (event.type === "plan" && isPlanPayload(event.data)) {
        setPlan(event.data);
      } else if (event.type === "status" || event.type === "error") {
        appendLog(typeof event.data === "string" ? event.data : JSON.stringify(event.data));
        if (event.type === "error") {
          setSession((prev) => (prev ? { ...prev, status: "error", error: typeof event.data === "string" ? event.data : "Unknown error" } : prev));
        }
      } else if (event.type === "log") {
        appendLog(typeof event.data === "string" ? event.data : JSON.stringify(event.data));
      } else if (event.type === "exit") {
        setSession((prev) => {
          if (!prev || prev.status !== "running") return prev;
          return { ...prev, status: "completed" };
        });
      }
    },
    [appendLog]
  );

  useEffect(() => {
    if (!activeRepo || !parentBeadId || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const result = await startBreakdown(activeRepo, parentBeadId);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "Failed to start breakdown");
        return;
      }

      setSession(result.data);
      const cleanup = connectToBreakdown(result.data.id, handleEvent, () => {
        appendLog("Connection lost");
      });
      cleanupRef.current = cleanup;
    })();

    return () => {
      cleanupRef.current?.();
    };
  }, [activeRepo, parentBeadId, handleEvent, appendLog]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  const handleAbort = useCallback(async () => {
    if (!session) return;
    const result = await abortBreakdown(session.id);
    if (result.ok) {
      setSession((prev) => (prev ? { ...prev, status: "aborted" } : prev));
      toast.success("Breakdown aborted");
    } else {
      toast.error(result.error ?? "Failed to abort");
    }
  }, [session]);

  const handleApply = useCallback(async () => {
    if (!session || !plan || !activeRepo) return;
    setIsApplying(true);

    const result = await applyBreakdown(session.id, activeRepo);
    setIsApplying(false);

    if (!result.ok || !result.data) {
      toast.error(result.error ?? "Failed to apply breakdown plan");
      return;
    }

    toast.success(
      `Created ${result.data.createdBeadIds.length} beats across ${result.data.waveCount} scenes`
    );
    queryClient.invalidateQueries({ queryKey: ["beads"] });

    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    params.delete("parent");
    params.set("bead", parentBeadId);
    router.push(`/beads?${params.toString()}`);
  }, [session, plan, activeRepo, queryClient, searchParams, router, parentBeadId]);

  const handleBack = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    params.delete("parent");
    router.push(`/beads?${params.toString()}`);
  }, [searchParams, router]);

  const status = session?.status ?? "idle";
  const isRunning = status === "running";
  const isDone = status === "completed";
  const canApply = isDone && plan && plan.waves.length > 0 && !isApplying;

  if (!parentBeadId) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        No parent beat specified. Go back to the beats list and use Breakdown from the create dialog.
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <section className="rounded-2xl border bg-gradient-to-br from-violet-50 via-purple-50 to-indigo-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight flex items-center gap-1.5">
              <Zap className="size-4" />
              Breakdown
            </h2>
            <p className="text-sm text-muted-foreground">
              Decomposing beat into implementation tasks...
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`${statusTone(status)} border px-2 py-0.5 text-xs`}
            >
              {status}
            </Badge>
            {isRunning && (
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5"
                title="Abort the breakdown session"
                onClick={handleAbort}
              >
                <Square className="size-3.5" />
                Abort
              </Button>
            )}
            {canApply && (
              <Button
                size="sm"
                className="gap-1.5"
                title="Create all beats from the plan"
                onClick={handleApply}
                disabled={isApplying}
              >
                {isApplying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                LGTM — Create Beats
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              title="Return to the beats list"
              onClick={handleBack}
            >
              Back to List
            </Button>
          </div>
        </div>
      </section>

      {plan && plan.waves.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Workflow className="size-4" />
            Scene Plan — {plan.waves.length} scene{plan.waves.length === 1 ? "" : "s"},{" "}
            {plan.waves.reduce((sum, w) => sum + w.beads.length, 0)} beats
          </h3>
          <p className="text-xs text-muted-foreground">{plan.summary}</p>

          {plan.waves.map((wave) => (
            <div
              key={wave.waveIndex}
              className="rounded-xl border bg-card p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono text-[11px]">
                  Scene {wave.waveIndex}
                </Badge>
                <span className="text-sm font-semibold">{wave.name}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {wave.objective}
              </p>
              <div className="space-y-1">
                {wave.beads.map((bead, index) => (
                  <div
                    key={index}
                    className="rounded-md border bg-white/90 px-2.5 py-1.5 text-xs flex items-center gap-2"
                  >
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {bead.type}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      P{bead.priority}
                    </span>
                    <span className="font-medium">{bead.title}</span>
                  </div>
                ))}
              </div>
              {wave.notes && (
                <p className="mt-2 text-[11px] text-muted-foreground italic">
                  {wave.notes}
                </p>
              )}
            </div>
          ))}

          {plan.assumptions.length > 0 && (
            <div className="rounded-lg border bg-yellow-50/50 p-3">
              <p className="text-xs font-semibold text-yellow-800 mb-1">
                Assumptions
              </p>
              <ul className="list-disc pl-4 text-xs text-yellow-700 space-y-0.5">
                {plan.assumptions.map((assumption, index) => (
                  <li key={index}>{assumption}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border bg-zinc-950 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-zinc-400 font-mono">Console</p>
          {isRunning && (
            <Loader2 className="size-3 animate-spin text-zinc-400" />
          )}
        </div>
        <div
          ref={logRef}
          className="max-h-60 overflow-y-auto font-mono text-[11px] text-zinc-300 whitespace-pre-wrap"
        >
          {logLines.length === 0 ? (
            <span className="text-zinc-500">Waiting for output...</span>
          ) : (
            logLines.map((line, index) => (
              <div key={index}>{line}</div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
