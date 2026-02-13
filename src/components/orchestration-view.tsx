"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Play,
  Rocket,
  Square,
  Users,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  abortOrchestration,
  applyOrchestration,
  connectToOrchestration,
  startOrchestration,
} from "@/lib/orchestration-api";
import { useAppStore } from "@/stores/app-store";
import type {
  ApplyOrchestrationResult,
  OrchestrationEvent,
  OrchestrationPlan,
  OrchestrationSession,
} from "@/lib/types";

const MAX_LOG_CHARS = 120_000;

interface OrchestrationViewProps {
  onApplied?: () => void;
}

function isPlanPayload(value: unknown): value is OrchestrationPlan {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.summary === "string" && Array.isArray(obj.waves);
}

function appendLog(prev: string, nextChunk: string): string {
  const next = prev + nextChunk;
  if (next.length <= MAX_LOG_CHARS) return next;
  return next.slice(next.length - MAX_LOG_CHARS);
}

function formatAgentLabel(agent: { role: string; count: number; specialty?: string }): string {
  const specialty = agent.specialty ? ` (${agent.specialty})` : "";
  return `${agent.count} x ${agent.role}${specialty}`;
}

function statusTone(status: OrchestrationSession["status"] | "idle") {
  if (status === "running") return "bg-blue-100 text-blue-700 border-blue-200";
  if (status === "completed") return "bg-green-100 text-green-700 border-green-200";
  if (status === "error") return "bg-red-100 text-red-700 border-red-200";
  if (status === "aborted") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

export function OrchestrationView({ onApplied }: OrchestrationViewProps) {
  const queryClient = useQueryClient();
  const { activeRepo, registeredRepos } = useAppStore();

  const [objective, setObjective] = useState("");
  const [session, setSession] = useState<OrchestrationSession | null>(null);
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [terminalText, setTerminalText] = useState("");
  const [statusText, setStatusText] = useState(
    "Ready to ask Claude for an orchestration plan"
  );
  const [isStarting, setIsStarting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyOrchestrationResult | null>(
    null
  );

  const terminalRef = useRef<HTMLDivElement>(null);
  const sessionId = session?.id;

  const repoLabel = useMemo(() => {
    if (!activeRepo) return "No repository selected";
    return (
      registeredRepos.find((repo) => repo.path === activeRepo)?.name ?? activeRepo
    );
  }, [activeRepo, registeredRepos]);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [terminalText]);

  useEffect(() => {
    if (!sessionId) return;

    const disconnect = connectToOrchestration(
      sessionId,
      (event: OrchestrationEvent) => {
        const message = typeof event.data === "string" ? event.data : null;

        if (event.type === "log" && message) {
          setTerminalText((prev) => appendLog(prev, message));
          return;
        }

        if (event.type === "plan" && isPlanPayload(event.data)) {
          setPlan(event.data);
          return;
        }

        if (event.type === "status" && message) {
          setStatusText(message);
          if (message.toLowerCase().includes("complete")) {
            setSession((prev) =>
              prev ? { ...prev, status: "completed", completedAt: new Date().toISOString() } : prev
            );
          }
          return;
        }

        if (event.type === "error" && message) {
          setStatusText(message);
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: "error",
                  error: message,
                  completedAt: new Date().toISOString(),
                }
              : prev
          );
          return;
        }

        if (event.type === "exit") {
          setSession((prev) => {
            if (!prev) return prev;
            const nextStatus = prev.status === "aborted" ? "aborted" : prev.status === "error" ? "error" : "completed";
            return {
              ...prev,
              status: nextStatus,
              completedAt: new Date().toISOString(),
            };
          });
        }
      },
      () => {
        setStatusText("Connection lost while streaming orchestration output");
      }
    );

    return disconnect;
  }, [sessionId]);

  const isRunning = session?.status === "running";
  const canApply = Boolean(session && plan && activeRepo && !isRunning);

  const handleStart = async () => {
    if (!activeRepo) {
      toast.error("Select a repository first");
      return;
    }

    setIsStarting(true);
    setApplyResult(null);
    setPlan(null);
    setTerminalText("");
    setStatusText("Starting Claude orchestration...");

    const result = await startOrchestration(activeRepo, objective);
    setIsStarting(false);

    if (!result.ok || !result.data) {
      toast.error(result.error ?? "Failed to start orchestration");
      setStatusText(result.error ?? "Failed to start orchestration");
      return;
    }

    setSession(result.data);
    setStatusText("Claude is organizing waves...");
  };

  const handleAbort = async () => {
    if (!session) return;
    const result = await abortOrchestration(session.id);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to abort orchestration");
      return;
    }
    setSession((prev) => (prev ? { ...prev, status: "aborted" } : prev));
    setStatusText("Orchestration aborted");
    toast.success("Orchestration terminated");
  };

  const handleApply = async () => {
    if (!session || !activeRepo || !plan) return;

    setIsApplying(true);
    const result = await applyOrchestration(session.id, activeRepo);
    setIsApplying(false);

    if (!result.ok || !result.data) {
      toast.error(result.error ?? "Failed to apply orchestration");
      return;
    }

    setApplyResult(result.data);
    queryClient.invalidateQueries({ queryKey: ["beads"] });
    onApplied?.();

    toast.success(
      `Created ${result.data.applied.length} wave bead${
        result.data.applied.length === 1 ? "" : "s"
      }`
    );
  };

  return (
    <div className="space-y-4 pb-4">
      <section className="rounded-2xl border bg-gradient-to-br from-slate-50 via-blue-50 to-cyan-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Orchestration View</h2>
            <p className="text-sm text-muted-foreground">
              Claude organizes dependency-aware waves, agent counts, and specialties for <span className="font-medium text-foreground">{repoLabel}</span>.
            </p>
          </div>
          <Badge variant="outline" className={statusTone(session?.status ?? "idle")}>
            {session?.status ?? "idle"}
          </Badge>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_auto]">
          <Textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Optional: steer orchestration (e.g. focus on backend first, or maximize QA parallelism)."
            className="min-h-20 bg-white"
            disabled={isRunning}
          />
          <div className="flex flex-wrap items-start gap-2 lg:flex-col lg:items-stretch">
            <Button
              className="gap-1.5"
              onClick={handleStart}
              disabled={!activeRepo || isStarting || isRunning}
            >
              {isStarting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {session ? "Run Again" : "Plan Waves"}
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={handleApply}
              disabled={!canApply || isApplying}
            >
              {isApplying ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Workflow className="size-4" />
              )}
              Apply Wave Beads
            </Button>
            {isRunning && (
              <Button
                variant="destructive"
                className="gap-1.5"
                onClick={handleAbort}
              >
                <Square className="size-4" />
                Abort
              </Button>
            )}
          </div>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">{statusText}</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border bg-[#0f172a] text-slate-100">
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2 text-xs">
            <div className="font-mono uppercase tracking-wide text-slate-300">Claude Stream</div>
            <div className="text-slate-400">live</div>
          </div>
          <div
            ref={terminalRef}
            className="h-[380px] overflow-auto px-3 py-2 font-mono text-xs leading-relaxed"
          >
            {terminalText ? (
              <pre className="whitespace-pre-wrap break-words">{terminalText}</pre>
            ) : (
              <p className="text-slate-500">No output yet. Start a planning run to stream Claude output.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Wave Diagram</h3>
            {plan ? (
              <Badge variant="secondary" className="text-[11px]">
                {plan.waves.length} wave{plan.waves.length === 1 ? "" : "s"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px]">
                waiting for draft
              </Badge>
            )}
          </div>

          {plan ? (
            <div className="space-y-3">
              {plan.waves.map((wave, index) => (
                <div key={`${wave.waveIndex}-${wave.name}`} className="relative rounded-xl border bg-slate-50 p-3">
                  {index < plan.waves.length - 1 && (
                    <div className="pointer-events-none absolute -bottom-3 left-4 h-3 border-l border-dashed border-slate-300" />
                  )}
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      Wave {wave.waveIndex}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{wave.beads.length} beads</span>
                  </div>
                  <p className="text-sm font-semibold">{wave.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{wave.objective}</p>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {wave.agents.length > 0 ? (
                      wave.agents.map((agent) => (
                        <Badge
                          key={`${wave.waveIndex}-${agent.role}-${agent.specialty ?? "none"}`}
                          variant="secondary"
                          className="gap-1 text-[10px]"
                        >
                          <Users className="size-3" />
                          {formatAgentLabel(agent)}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">1 x generalist</Badge>
                    )}
                  </div>

                  <ul className="mt-2 space-y-1">
                    {wave.beads.map((bead) => (
                      <li key={bead.id} className="rounded-md border bg-white px-2 py-1 text-xs">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {bead.id.replace(/^[^-]+-/, "")}
                        </span>
                        <span className="ml-1.5">{bead.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {plan.unassignedBeadIds.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Unassigned
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {plan.unassignedBeadIds.map((id) => (
                      <Badge key={id} variant="outline" className="font-mono text-[10px]">
                        {id.replace(/^[^-]+-/, "")}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Wave cards appear here as Claude drafts each wave.
            </div>
          )}
        </section>
      </div>

      {plan && (
        <section className="rounded-2xl border bg-card p-3">
          <p className="text-sm font-semibold">Planner Summary</p>
          <p className="mt-1 text-sm text-muted-foreground">{plan.summary}</p>

          {plan.assumptions.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Assumptions
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {plan.assumptions.map((assumption, idx) => (
                  <li key={`${assumption}-${idx}`} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-3.5 text-green-700" />
                    <span>{assumption}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {applyResult && (
            <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Applied
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {applyResult.applied.map((wave) => (
                  <li key={wave.waveId} className="flex items-center gap-2">
                    <Rocket className="size-3.5 text-emerald-700" />
                    <span>
                      {wave.waveTitle} ({wave.childCount} child bead{wave.childCount === 1 ? "" : "s"})
                    </span>
                    <span className="font-mono text-xs text-emerald-700">{wave.waveId}</span>
                  </li>
                ))}
              </ul>
              {applyResult.skipped.length > 0 && (
                <p className="mt-2 text-xs text-amber-800">
                  Skipped: {applyResult.skipped.join(", ")}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
