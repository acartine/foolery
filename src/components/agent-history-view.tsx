"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Clock3, MessageSquareText, Sparkles, Workflow } from "lucide-react";
import type {
  AgentHistoryBeatSummary,
  AgentHistoryEntry,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { fetchAgentHistory } from "@/lib/agent-history-api";
import { useAppStore } from "@/stores/app-store";
import { Badge } from "@/components/ui/badge";

function beadKey(beadId: string, repoPath: string): string {
  return `${repoPath}::${beadId}`;
}

function parseBeadKey(value: string | null): { beadId: string; repoPath: string } | null {
  if (!value) return null;
  const pivot = value.lastIndexOf("::");
  if (pivot <= 0) return null;
  const repoPath = value.slice(0, pivot);
  const beadId = value.slice(pivot + 2);
  if (!repoPath || !beadId) return null;
  return { beadId, repoPath };
}

function formatTime(value: string | undefined): string {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function relativeTime(value: string): string {
  const now = Date.now();
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return value;
  const diff = now - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function promptSourceLabel(source?: string): string {
  if (!source) return "Prompt";
  if (source === "initial") return "Initial prompt";
  if (source === "execution_follow_up") return "Execution follow-up";
  if (source === "ship_completion_follow_up") return "Ship follow-up";
  if (source === "scene_completion_follow_up") return "Scene follow-up";
  if (source === "auto_ask_user_response") return "Auto AskUser response";
  return source.replace(/_/g, " ");
}

function clipDisplay(text: string, maxChars = 8_000): string {
  if (text.length <= maxChars) return text;
  const extra = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n... [truncated ${extra} chars]`;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function summarizeAssistant(obj: Record<string, unknown>): string | null {
  const message = toObject(obj.message);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return null;

  const parts: string[] = [];
  for (const rawBlock of content) {
    const block = toObject(rawBlock);
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text.trim();
      if (text) parts.push(text);
      continue;
    }
    if (block.type === "tool_use") {
      const name = typeof block.name === "string" ? block.name : "tool";
      const input = toObject(block.input);
      let summary = "";
      if (typeof input?.command === "string") summary = ` ${input.command}`;
      else if (typeof input?.description === "string") summary = ` ${input.description}`;
      else if (typeof input?.file_path === "string") summary = ` ${input.file_path}`;
      parts.push(`▶ ${name}${summary}`.trim());
    }
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

function summarizeUser(obj: Record<string, unknown>): string | null {
  const message = toObject(obj.message);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return null;

  for (const rawBlock of content) {
    const block = toObject(rawBlock);
    if (!block) continue;
    if (block.type === "tool_result") {
      const rawContent = block.content;
      if (typeof rawContent === "string") return rawContent;
      return JSON.stringify(rawContent);
    }
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }

  return null;
}

function summarizeResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return clipDisplay(raw);

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof parsed.type === "string" ? parsed.type : "";

    if (type === "assistant") {
      const summary = summarizeAssistant(parsed);
      if (summary) return clipDisplay(summary);
    }

    if (type === "user") {
      const summary = summarizeUser(parsed);
      if (summary) return clipDisplay(summary);
    }

    if (type === "result") {
      const resultText = typeof parsed.result === "string" ? parsed.result : "(no result text)";
      const cost = typeof parsed.cost_usd === "number" ? `$${parsed.cost_usd.toFixed(4)}` : null;
      const duration = typeof parsed.duration_ms === "number" ? `${(parsed.duration_ms / 1000).toFixed(1)}s` : null;
      const meta = [cost, duration].filter(Boolean).join(", ");
      return clipDisplay(meta ? `${resultText}\n(${meta})` : resultText);
    }

    if (type === "system") {
      const subtype = typeof parsed.subtype === "string" ? parsed.subtype : "event";
      const hookName = typeof parsed.hook_name === "string" ? parsed.hook_name : null;
      const outcome = typeof parsed.outcome === "string" ? parsed.outcome : null;
      const extra = [hookName, outcome].filter(Boolean).join(" · ");
      return clipDisplay(extra ? `system:${subtype} · ${extra}` : `system:${subtype}`);
    }

    return clipDisplay(JSON.stringify(parsed, null, 2));
  } catch {
    return clipDisplay(raw);
  }
}

function statusTone(status?: string): string {
  if (status === "completed") return "border-green-200 bg-green-50 text-green-700";
  if (status === "error") return "border-red-200 bg-red-50 text-red-700";
  if (status === "aborted") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "running") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-zinc-200 bg-zinc-100 text-zinc-700";
}

function SessionEntryRow({ entry }: { entry: AgentHistoryEntry }) {
  if (entry.kind === "session_start") {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Session started at {formatTime(entry.ts)}
      </div>
    );
  }

  if (entry.kind === "session_end") {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Session ended at {formatTime(entry.ts)}
        {entry.status ? ` · ${entry.status}` : ""}
        {entry.exitCode !== undefined ? ` · exit ${entry.exitCode}` : ""}
      </div>
    );
  }

  if (entry.kind === "prompt") {
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-blue-700">
          <MessageSquareText className="size-3.5" />
          <span className="font-semibold">App → Agent</span>
          <Badge variant="outline" className="text-[10px] font-normal">
            {promptSourceLabel(entry.promptSource)}
          </Badge>
          <span>{formatTime(entry.ts)}</span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-blue-900">
          {entry.prompt ?? "(empty prompt)"}
        </pre>
      </div>
    );
  }

  const raw = entry.raw ?? "";
  const summary = summarizeResponse(raw);
  const showRaw = raw.trim().length > 0 && summary.trim() !== raw.trim();

  return (
    <div className="rounded-md border border-border/70 bg-background px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Bot className="size-3.5" />
        <span className="font-semibold text-foreground">Agent → App</span>
        <span>{formatTime(entry.ts)}</span>
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
        {summary || "(empty response)"}
      </pre>
      {showRaw ? (
        <details className="mt-2 rounded border border-border/50 bg-muted/30 px-2 py-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Raw event</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground">
            {clipDisplay(raw, 16_000)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function SessionCard({ session }: { session: AgentHistorySession }) {
  return (
    <section className="rounded-lg border border-border/70 bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <Badge variant="secondary" className="uppercase">
          {session.interactionType === "scene" ? "Scene!" : "Take!"}
        </Badge>
        <Badge variant="outline" className={statusTone(session.status)}>
          {session.status ?? "unknown"}
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground">{session.sessionId}</span>
        <span className="ml-auto text-xs text-muted-foreground">{formatTime(session.updatedAt)}</span>
      </header>
      <div className="space-y-2 p-3">
        {session.entries.length === 0 ? (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            No log entries captured for this session.
          </div>
        ) : (
          session.entries.map((entry) => <SessionEntryRow key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}

export function AgentHistoryView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const [selectedBeadKey, setSelectedBeadKey] = useState<string | null>(null);

  const selectedBead = useMemo(() => parseBeadKey(selectedBeadKey), [selectedBeadKey]);

  const historyQuery = useQuery({
    queryKey: [
      "agent-history",
      activeRepo,
      selectedBead?.repoPath ?? null,
      selectedBead?.beadId ?? null,
    ],
    queryFn: () =>
      fetchAgentHistory({
        repoPath: activeRepo ?? undefined,
        beadId: selectedBead?.beadId,
        beadRepoPath: selectedBead?.repoPath,
      }),
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
  });

  const beats = useMemo(
    () => (historyQuery.data?.ok ? historyQuery.data.data?.beats ?? [] : []),
    [historyQuery.data],
  );

  useEffect(() => {
    if (beats.length === 0) {
      if (selectedBeadKey !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Selection state is derived from latest loaded list and intentionally reset when list empties.
        setSelectedBeadKey(null);
      }
      return;
    }

    const selectedStillPresent =
      selectedBeadKey !== null &&
      beats.some((beat) => beadKey(beat.beadId, beat.repoPath) === selectedBeadKey);

    if (!selectedStillPresent) {
      setSelectedBeadKey(beadKey(beats[0].beadId, beats[0].repoPath));
    }
  }, [beats, selectedBeadKey]);

  const selectedSummary = useMemo<AgentHistoryBeatSummary | null>(
    () =>
      selectedBeadKey
        ? beats.find((beat) => beadKey(beat.beadId, beat.repoPath) === selectedBeadKey) ?? null
        : null,
    [beats, selectedBeadKey],
  );

  const payloadSelectedKey = useMemo(() => {
    const payload = historyQuery.data?.ok ? historyQuery.data.data : undefined;
    const payloadBeadId = payload?.selectedBeadId;
    if (!payloadBeadId) return null;
    const payloadRepo = payload?.selectedRepoPath ?? selectedBead?.repoPath ?? activeRepo;
    if (!payloadRepo) return null;
    return beadKey(payloadBeadId, payloadRepo);
  }, [historyQuery.data, selectedBead?.repoPath, activeRepo]);

  const sessions = useMemo(() => {
    if (!historyQuery.data?.ok) return [];
    if (!selectedBeadKey) return [];
    if (payloadSelectedKey !== selectedBeadKey) return [];
    return historyQuery.data.data?.sessions ?? [];
  }, [historyQuery.data, payloadSelectedKey, selectedBeadKey]);

  const repoNames = useMemo(
    () =>
      new Map(
        registeredRepos.map((repo) => [repo.path, repo.name]),
      ),
    [registeredRepos],
  );

  const showRepoName = !activeRepo && registeredRepos.length > 1;

  if (!activeRepo && registeredRepos.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        Add a repository to view agent history.
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-h-[420px] rounded-lg border border-border/70 bg-card">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="text-sm font-semibold">Agent History</p>
          <p className="text-xs text-muted-foreground">
            Take!/Scene activity ordered by most recent work.
          </p>
        </div>

        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          {historyQuery.isLoading ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Loading history...</div>
          ) : historyQuery.data && !historyQuery.data.ok ? (
            <div className="px-3 py-4 text-sm text-destructive">
              {historyQuery.data.error ?? "Failed to load history"}
            </div>
          ) : beats.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No Take!/Scene history found yet.
            </div>
          ) : (
            beats.map((beat) => {
              const key = beadKey(beat.beadId, beat.repoPath);
              const selected = selectedBeadKey === key;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => setSelectedBeadKey(key)}
                  className={`block w-full border-b border-border/50 px-3 py-2 text-left transition-colors ${
                    selected ? "bg-muted/50" : "hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {beat.title?.trim() || beat.beadId}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(beat.lastWorkedAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-mono">{beat.beadId}</span>
                    {showRepoName ? (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {repoNames.get(beat.repoPath) ?? beat.repoPath}
                      </Badge>
                    ) : null}
                    <span>{beat.sessionCount} sessions</span>
                    <span>{beat.takeCount} take</span>
                    <span>{beat.sceneCount} scene</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="min-h-[420px] rounded-lg border border-border/70 bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <p className="text-sm font-semibold">
            {selectedSummary
              ? selectedSummary.title?.trim() || selectedSummary.beadId
              : "Select a beat"}
          </p>
          {selectedSummary ? (
            <span className="font-mono text-xs text-muted-foreground">{selectedSummary.beadId}</span>
          ) : null}
          {selectedSummary && showRepoName ? (
            <Badge variant="outline" className="text-[10px] font-normal">
              {repoNames.get(selectedSummary.repoPath) ?? selectedSummary.repoPath}
            </Badge>
          ) : null}
          {selectedSummary ? (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              Last worked {relativeTime(selectedSummary.lastWorkedAt)}
            </span>
          ) : null}
        </div>

        <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-3">
          {!selectedSummary ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Select a beat from the left to inspect app and agent logs.
            </div>
          ) : historyQuery.isFetching && payloadSelectedKey !== selectedBeadKey ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Loading logs for {selectedSummary.beadId}...
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No captured log sessions for this beat yet.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Workflow className="size-3.5" />
                {sessions.length} session{sessions.length === 1 ? "" : "s"}
              </div>
              {sessions.map((session) => (
                <SessionCard key={session.sessionId} session={session} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
