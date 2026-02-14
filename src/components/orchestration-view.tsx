"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  Play,
  Rocket,
  Square,
  Users,
  Workflow,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  abortOrchestration,
  applyOrchestration,
  connectToOrchestration,
  startOrchestration,
} from "@/lib/orchestration-api";
import {
  ORCHESTRATION_RESTAGE_DRAFT_KEY,
  type OrchestrationRestageDraft,
} from "@/lib/orchestration-restage";
import {
  clearOrchestrationViewState,
  loadOrchestrationViewState,
  saveOrchestrationViewState,
} from "@/lib/orchestration-state";
import { startSession } from "@/lib/terminal-api";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import type {
  ApplyOrchestrationResult,
  OrchestrationEvent,
  OrchestrationPlan,
  OrchestrationSession,
} from "@/lib/types";
import { normalizeWaveSlugCandidate } from "@/lib/wave-slugs";

const MAX_LOG_LINES = 900;

interface OrchestrationViewProps {
  onApplied?: () => void;
}

export type ExtraValue =
  | { kind: "primitive"; text: string }
  | { kind: "object"; entries: { key: string; value: ExtraValue }[] }
  | { kind: "array"; items: ExtraValue[] };

export interface LogExtraField {
  key: string;
  value: ExtraValue;
}

export interface LogLine {
  id: string;
  type: "structured" | "plain";
  event?: string;
  text: string;
  extras?: LogExtraField[];
}

function isPlanPayload(value: unknown): value is OrchestrationPlan {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.summary === "string" && Array.isArray(obj.waves);
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

const MAX_EXTRA_DEPTH = 5;
const MAX_ARRAY_ITEMS = 20;
const MAX_PRIMITIVE_LEN = 300;

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if ((!trimmed.startsWith("{") && !trimmed.startsWith("[")) || trimmed.length < 2) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseExtraValue(value: unknown, depth = 0): ExtraValue {
  if (depth >= MAX_EXTRA_DEPTH) {
    const fallback = typeof value === "string" ? value : JSON.stringify(value) ?? "";
    return {
      kind: "primitive",
      text: fallback.length > MAX_PRIMITIVE_LEN ? `${fallback.slice(0, MAX_PRIMITIVE_LEN)}...` : fallback,
    };
  }

  if (value === null || value === undefined) {
    return { kind: "primitive", text: String(value) };
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value);
    return {
      kind: "primitive",
      text: text.length > MAX_PRIMITIVE_LEN ? `${text.slice(0, MAX_PRIMITIVE_LEN)}...` : text,
    };
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => parseExtraValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push({ kind: "primitive", text: `... +${value.length - MAX_ARRAY_ITEMS} more` });
    }
    return { kind: "array", items };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: parseExtraValue(v, depth + 1),
    }));
    return { kind: "object", entries };
  }

  return { kind: "primitive", text: String(value) };
}

const KEY_COLORS = [
  "text-sky-400",
  "text-amber-400",
  "text-emerald-400",
  "text-pink-400",
  "text-violet-400",
  "text-orange-400",
  "text-teal-400",
  "text-rose-400",
] as const;

function keyTone(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return KEY_COLORS[Math.abs(hash) % KEY_COLORS.length];
}

function eventTone(eventName: string): string {
  const normalized = eventName.toLowerCase();
  if (normalized.includes("error")) return "text-red-300";
  if (normalized.includes("wave")) return "text-violet-300";
  if (normalized.includes("plan")) return "text-emerald-300";
  if (normalized.includes("thinking")) return "text-sky-300";
  if (normalized.includes("status")) return "text-amber-300";
  return "text-cyan-300";
}

function parseLogLine(line: string, id: string): LogLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return {
      id,
      type: "plain",
      text: line,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const event = typeof parsed.event === "string" ? parsed.event.trim() : "";
    if (!event) {
      return {
        id,
        type: "plain",
        text: line,
      };
    }

    const text =
      typeof parsed.text === "string"
        ? parsed.text
        : typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.result === "string"
            ? parsed.result
            : "";

    const extras = Object.entries(parsed)
      .filter(([key]) => !["event", "text", "message", "result"].includes(key))
      .map(([key, value]) => ({ key, value: parseExtraValue(tryParseJson(value)) }))
      .filter((entry) => {
        if (entry.value.kind === "primitive") return entry.value.text.length > 0;
        return true;
      });

    return {
      id,
      type: "structured",
      event,
      text,
      extras,
    };
  } catch {
    return {
      id,
      type: "plain",
      text: line,
    };
  }
}

function ExtraValueNode({ value, depth = 0 }: { value: ExtraValue; depth?: number }) {
  const indent = depth > 0 ? "pl-3" : "";

  if (value.kind === "primitive") {
    return <span className="text-slate-300">{value.text}</span>;
  }

  if (value.kind === "array") {
    if (value.items.length === 0) {
      return <span className="text-slate-500">[]</span>;
    }

    const allPrimitive = value.items.every((item) => item.kind === "primitive");
    if (allPrimitive && value.items.length <= 3) {
      return (
        <span className="text-slate-300">
          [{value.items.map((item, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <ExtraValueNode value={item} depth={depth + 1} />
            </span>
          ))}]
        </span>
      );
    }

    return (
      <div className={indent}>
        {value.items.map((item, index) => (
          <div key={index} className="flex items-start gap-1">
            <span className="text-slate-600 select-none">{index}.</span>
            <div className="min-w-0 flex-1">
              <ExtraValueNode value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (value.entries.length === 0) {
    return <span className="text-slate-500">{"{}"}</span>;
  }

  return (
    <div className={indent}>
      {value.entries.map((entry) => (
        <div key={entry.key}>
          <span className={`font-medium ${keyTone(entry.key)}`}>{entry.key}</span>
          <span className="text-slate-600">: </span>
          {entry.value.kind === "primitive" ? (
            <ExtraValueNode value={entry.value} depth={depth + 1} />
          ) : (
            <div className="mt-0.5">
              <ExtraValueNode value={entry.value} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function normalizeStatusText(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (clean.length <= 180) return clean;
  return `${clean.slice(0, 180)}...`;
}

function normalizeStoredWaveEdits(
  waveEdits: OrchestrationRestageDraft["waveEdits"] | undefined
): Record<number, { name: string; slug: string }> {
  if (!waveEdits) return {};
  const normalized: Record<number, { name: string; slug: string }> = {};
  for (const [key, value] of Object.entries(waveEdits)) {
    const waveIndex = Number(key);
    if (!Number.isFinite(waveIndex)) continue;
    normalized[Math.trunc(waveIndex)] = {
      name: value?.name ?? "",
      slug: value?.slug ?? "",
    };
  }
  return normalized;
}

export function OrchestrationView({ onApplied }: OrchestrationViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeRepo, registeredRepos } = useAppStore();
  const { terminals, setActiveSession, upsertTerminal } = useTerminalStore();

  const [objective, setObjective] = useState("");
  const [session, setSession] = useState<OrchestrationSession | null>(null);
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [statusText, setStatusText] = useState(
    "Ready to ask Claude for an orchestration plan"
  );
  const [waveEdits, setWaveEdits] = useState<
    Record<number, { name: string; slug: string }>
  >({});
  const [isStarting, setIsStarting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isTriggeringNow, setIsTriggeringNow] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyOrchestrationResult | null>(
    null
  );

  const terminalRef = useRef<HTMLDivElement>(null);
  const pendingLogRef = useRef("");
  const sessionId = session?.id;

  const repoLabel = useMemo(() => {
    if (!activeRepo) return "No repository selected";
    return (
      registeredRepos.find((repo) => repo.path === activeRepo)?.name ?? activeRepo
    );
  }, [activeRepo, registeredRepos]);

  useEffect(() => {
    if (!activeRepo || typeof window === "undefined") return;

    // 1. Restage draft takes priority (intentional user action)
    const rawDraft = window.sessionStorage.getItem(ORCHESTRATION_RESTAGE_DRAFT_KEY);
    if (rawDraft) {
      let draft: OrchestrationRestageDraft | null = null;
      try {
        draft = JSON.parse(rawDraft) as OrchestrationRestageDraft;
      } catch {
        window.sessionStorage.removeItem(ORCHESTRATION_RESTAGE_DRAFT_KEY);
      }

      if (draft && draft.repoPath === activeRepo && isPlanPayload(draft.plan)) {
        window.sessionStorage.removeItem(ORCHESTRATION_RESTAGE_DRAFT_KEY);
        const hydrationTimer = window.setTimeout(() => {
          setSession(draft.session);
          setPlan(draft.plan);
          setWaveEdits(normalizeStoredWaveEdits(draft.waveEdits));
          setApplyResult(null);
          setLogLines([]);
          pendingLogRef.current = "";
          if (draft.objective) setObjective(draft.objective);
          setStatusText(
            draft.statusText ?? "Restaged existing groups into Orchestrate view"
          );
          toast.success(
            `Restaged ${draft.plan.waves.length} section${
              draft.plan.waves.length === 1 ? "" : "s"
            } into Orchestrate`
          );
        }, 0);
        return () => window.clearTimeout(hydrationTimer);
      }
    }

    // 2. Restore saved view state (preserves state across view toggles)
    const saved = loadOrchestrationViewState(activeRepo);
    if (!saved) return;

    clearOrchestrationViewState();
    const hydrationTimer = window.setTimeout(() => {
      setSession(saved.session);
      setPlan(saved.plan);
      setWaveEdits(saved.waveEdits);
      setObjective(saved.objective);
      setStatusText(saved.statusText);
      setLogLines(saved.logLines);
      setApplyResult(saved.applyResult);
      pendingLogRef.current = "";
    }, 0);

    return () => window.clearTimeout(hydrationTimer);
  }, [activeRepo]);

  const nextWaveToTrigger = useMemo(() => {
    if (!applyResult || applyResult.applied.length === 0) return null;
    return [...applyResult.applied].sort((a, b) => a.waveIndex - b.waveIndex)[0] ?? null;
  }, [applyResult]);

  const appendLogChunk = useCallback((chunk: string) => {
    const combined = pendingLogRef.current + chunk;
    const lines = combined.split(/\r?\n/);
    pendingLogRef.current = lines.pop() ?? "";

    if (lines.length === 0) return;

    setLogLines((prev) => {
      const timestamp = Date.now();
      const next = [...prev];
      lines.forEach((line, index) => {
        next.push(parseLogLine(line, `${timestamp}-${index}-${next.length}`));
      });
      if (next.length <= MAX_LOG_LINES) return next;
      return next.slice(next.length - MAX_LOG_LINES);
    });
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logLines]);

  useEffect(() => {
    if (!sessionId) return;

    const disconnect = connectToOrchestration(
      sessionId,
      (event: OrchestrationEvent) => {
        const message = typeof event.data === "string" ? event.data : null;

        if (event.type === "log" && message) {
          appendLogChunk(message);
          return;
        }

        if (event.type === "plan" && isPlanPayload(event.data)) {
          setPlan(event.data);
          return;
        }

        if (event.type === "status" && message) {
          setStatusText(normalizeStatusText(message));
          if (message.toLowerCase().includes("complete")) {
            setSession((prev) =>
              prev ? { ...prev, status: "completed", completedAt: new Date().toISOString() } : prev
            );
          }
          return;
        }

        if (event.type === "error" && message) {
          setStatusText(normalizeStatusText(message));
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
          if (pendingLogRef.current.trim()) {
            appendLogChunk(`${pendingLogRef.current}\n`);
            pendingLogRef.current = "";
          }
          setSession((prev) => {
            if (!prev) return prev;
            const nextStatus =
              prev.status === "aborted"
                ? "aborted"
                : prev.status === "error"
                  ? "error"
                  : "completed";
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
  }, [appendLogChunk, sessionId]);

  // Auto-save orchestration state for view-toggle preservation
  useEffect(() => {
    const hasWork = session !== null || plan !== null || logLines.length > 0;
    if (!hasWork || !activeRepo) {
      clearOrchestrationViewState();
      return;
    }

    const timer = window.setTimeout(() => {
      saveOrchestrationViewState({
        session,
        plan,
        objective,
        waveEdits,
        statusText,
        logLines,
        applyResult,
        repoPath: activeRepo,
        savedAt: Date.now(),
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [session, plan, objective, waveEdits, statusText, logLines, applyResult, activeRepo]);

  const isRunning = session?.status === "running";
  const canApply = Boolean(session && plan && activeRepo && !isRunning);

  const handleStart = async () => {
    if (!activeRepo) {
      toast.error("Select a repository first");
      return;
    }

    clearOrchestrationViewState();
    setIsStarting(true);
    setApplyResult(null);
    setWaveEdits({});
    setPlan(null);
    pendingLogRef.current = "";
    setLogLines([]);
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

    const waveNames: Record<string, string> = {};
    const waveSlugs: Record<string, string> = {};
    for (const wave of plan.waves) {
      const edit = waveEdits[wave.waveIndex];
      const name = edit?.name?.trim();
      if (name) waveNames[String(wave.waveIndex)] = name;
      const slug = normalizeWaveSlugCandidate(edit?.slug ?? "");
      if (slug) waveSlugs[String(wave.waveIndex)] = slug;
    }

    setIsApplying(true);
    const result = await applyOrchestration(session.id, activeRepo, {
      waveNames,
      waveSlugs,
    });
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

  const handleTriggerNow = async () => {
    if (!activeRepo || !nextWaveToTrigger) return;

    const existingRunning = terminals.find(
      (terminal) =>
        terminal.beadId === nextWaveToTrigger.waveId && terminal.status === "running"
    );
    if (existingRunning) {
      setActiveSession(existingRunning.sessionId);
      router.push("/beads");
      return;
    }

    setIsTriggeringNow(true);
    const result = await startSession(nextWaveToTrigger.waveId, activeRepo);
    setIsTriggeringNow(false);

    if (!result.ok || !result.data) {
      toast.error(result.error ?? "Failed to trigger ship session");
      return;
    }

    upsertTerminal({
      sessionId: result.data.id,
      beadId: nextWaveToTrigger.waveId,
      beadTitle: nextWaveToTrigger.waveTitle,
      status: "running",
      startedAt: new Date().toISOString(),
    });

    toast.success(`Triggered ${nextWaveToTrigger.waveTitle}`);
    router.push("/beads");
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
            <div className="font-mono uppercase tracking-wide text-slate-300">Orchestration Console</div>
            <div className="text-slate-400">live</div>
          </div>
          <div
            ref={terminalRef}
            className="h-[380px] overflow-auto px-3 py-2 font-mono text-xs leading-relaxed"
          >
            {logLines.length > 0 ? (
              <div className="space-y-1">
                {logLines.map((line) =>
                  line.type === "structured" ? (
                    <div key={line.id} className="whitespace-pre-wrap break-words">
                      <span className={`font-semibold ${eventTone(line.event ?? "")}`}>
                        {line.event}
                      </span>
                      <span className="text-slate-500"> | </span>
                      <span className="text-slate-200">{line.text || "(no text)"}</span>
                      {line.extras && line.extras.length > 0 && (
                        <div className="mt-0.5 space-y-0.5 pl-3 text-slate-400">
                          {line.extras.map((extra) => (
                            <div key={`${line.id}-${extra.key}`}>
                              <span className={`font-medium ${keyTone(extra.key)}`}>{extra.key}</span>
                              <span className="text-slate-600">: </span>
                              {extra.value.kind === "primitive" ? (
                                <span className="text-slate-300">{extra.value.text}</span>
                              ) : (
                                <div className="mt-0.5">
                                  <ExtraValueNode value={extra.value} depth={1} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div key={line.id} className="whitespace-pre-wrap break-words text-slate-300">
                      {line.text}
                    </div>
                  )
                )}
              </div>
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
	                  <div className="mt-1 space-y-1.5">
	                    <Input
	                      value={waveEdits[wave.waveIndex]?.name ?? wave.name}
	                      onChange={(event) =>
	                        setWaveEdits((prev) => ({
	                          ...prev,
	                          [wave.waveIndex]: {
	                            name: event.target.value,
	                            slug: prev[wave.waveIndex]?.slug ?? "",
	                          },
	                        }))
	                      }
	                      className="h-8 bg-white text-sm font-semibold"
	                      disabled={isRunning || isApplying}
	                    />
	                    <div className="flex items-center gap-2">
	                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
	                        slug
	                      </span>
	                      <Input
	                        value={waveEdits[wave.waveIndex]?.slug ?? ""}
	                        onChange={(event) =>
	                          setWaveEdits((prev) => ({
	                            ...prev,
	                            [wave.waveIndex]: {
	                              name: prev[wave.waveIndex]?.name ?? wave.name,
	                              slug: event.target.value,
	                            },
	                          }))
	                        }
	                        placeholder="auto-generated (e.g. streep-montage)"
	                        className="h-7 bg-white font-mono text-[11px]"
	                        disabled={isRunning || isApplying}
	                      />
	                    </div>
	                  </div>
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
              <ul className="mt-2 space-y-2 text-sm">
                {applyResult.applied.map((wave) => (
                  <li key={wave.waveId}>
                    <div className="flex items-center gap-2">
                      <Rocket className="size-3.5 text-emerald-700" />
                      <span>
                        {wave.waveTitle} ({wave.childCount} child bead{wave.childCount === 1 ? "" : "s"})
                      </span>
                      <span className="font-mono text-xs text-emerald-700">{wave.waveId}</span>
                    </div>
                    {wave.children.length > 0 && (
                      <ul className="ml-6 mt-1 space-y-0.5">
                        {wave.children.map((child) => (
                          <li key={child.id} className="flex items-center gap-1.5 text-xs text-emerald-900/70">
                            <ChevronRight className="size-3 text-emerald-600" />
                            <span className="font-mono">{child.id}</span>
                            <span className="truncate">{child.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={handleTriggerNow}
                  disabled={!nextWaveToTrigger || isTriggeringNow}
                >
                  {isTriggeringNow ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Rocket className="size-3.5" />
                  )}
                  Trigger Now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => router.push("/beads")}
                >
                  <ArrowRight className="size-3.5" />
                  Back to List
                </Button>
              </div>

              {applyResult.skipped.length > 0 && (
                <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Skipped: {applyResult.skipped.join(", ")}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
