"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Clock3,
  FileText,
  MessageSquareText,
  Sparkles,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import { fetchBead } from "@/lib/api";
import type {
  AgentHistoryBeatSummary,
  AgentHistoryEntry,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { fetchAgentHistory } from "@/lib/agent-history-api";
import type { Bead } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { Badge } from "@/components/ui/badge";

const RECENT_HOURS = 24;
const TITLE_VISIBLE_COUNT = 5;
const TITLE_ROW_HEIGHT_PX = 56;
const TOP_PANEL_HEADER_HEIGHT_PX = 74;
const TOP_PANEL_HEIGHT_PX = TITLE_VISIBLE_COUNT * TITLE_ROW_HEIGHT_PX + TOP_PANEL_HEADER_HEIGHT_PX;

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

function parseMillis(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function isRecent(value: string, hours: number): boolean {
  if (!hours || hours <= 0) return true;
  const ts = parseMillis(value);
  if (!ts) return false;
  return ts >= Date.now() - hours * 60 * 60 * 1000;
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
  if (status === "completed") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  if (status === "error") return "border-red-500/40 bg-red-500/15 text-red-200";
  if (status === "aborted") return "border-amber-500/40 bg-amber-500/15 text-amber-200";
  if (status === "running") return "border-sky-500/40 bg-sky-500/15 text-sky-200";
  return "border-slate-600 bg-slate-800 text-slate-200";
}

function BeadMetaItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded border border-border/50 bg-muted/20 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-[11px]">{value?.trim() || "—"}</p>
    </div>
  );
}

function SessionEntryRow({ entry }: { entry: AgentHistoryEntry }) {
  if (entry.kind === "session_start") {
    return (
      <div className="rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-300">
        Session started at {formatTime(entry.ts)}
      </div>
    );
  }

  if (entry.kind === "session_end") {
    return (
      <div className="rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-300">
        Session ended at {formatTime(entry.ts)}
        {entry.status ? ` · ${entry.status}` : ""}
        {entry.exitCode !== undefined ? ` · exit ${entry.exitCode}` : ""}
      </div>
    );
  }

  if (entry.kind === "prompt") {
    return (
      <div className="rounded border border-sky-500/50 bg-sky-950/35 px-3 py-2">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-sky-200">
          <MessageSquareText className="size-3.5" />
          <span className="font-semibold uppercase tracking-wide">App -&gt; Agent</span>
          <Badge variant="outline" className="border-sky-400/40 bg-sky-900/40 text-[10px] font-normal text-sky-100">
            {promptSourceLabel(entry.promptSource)}
          </Badge>
          <span>{formatTime(entry.ts)}</span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-sky-100">
          {entry.prompt ?? "(empty prompt)"}
        </pre>
      </div>
    );
  }

  const raw = entry.raw ?? "";
  const summary = summarizeResponse(raw);
  const showRaw = raw.trim().length > 0 && summary.trim() !== raw.trim();

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60 px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-300">
        <Bot className="size-3.5" />
        <span className="font-semibold uppercase tracking-wide text-slate-100">Agent -&gt; App</span>
        <span>{formatTime(entry.ts)}</span>
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-slate-100">
        {summary || "(empty response)"}
      </pre>
      {showRaw ? (
        <details className="mt-2 rounded border border-slate-700 bg-black/40 px-2 py-1 text-[10px]">
          <summary className="cursor-pointer text-slate-400">Raw event</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-slate-200">
            {clipDisplay(raw, 16_000)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function SessionCard({ session }: { session: AgentHistorySession }) {
  return (
    <section className="rounded border border-slate-700 bg-[#0b1020]">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-2">
        <Badge variant="outline" className="border-violet-500/40 bg-violet-500/20 text-[10px] uppercase text-violet-100">
          {session.interactionType === "scene" ? "Scene!" : "Take!"}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${statusTone(session.status)}`}>
          {session.status ?? "unknown"}
        </Badge>
        <span className="font-mono text-[10px] text-slate-400">{session.sessionId}</span>
        <span className="ml-auto text-[10px] text-slate-400">{formatTime(session.updatedAt)}</span>
      </header>
      <div className="space-y-2 p-3">
        {session.entries.length === 0 ? (
          <div className="rounded border border-slate-700 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-300">
            No log entries captured for this session.
          </div>
        ) : (
          session.entries.map((entry) => <SessionEntryRow key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}

function renderLongText(label: string, value?: string) {
  if (!value?.trim()) return null;
  return (
    <section className="rounded border border-border/50 bg-muted/10 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground">
        {value}
      </pre>
    </section>
  );
}

function BeadDetailContent({ bead, summary }: { bead: Bead | null; summary: AgentHistoryBeatSummary }) {
  if (!bead) {
    return (
      <div className="rounded border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
        Beat details are unavailable for this repository entry.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <BeadMetaItem label="Beat ID" value={bead.id} />
        <BeadMetaItem label="Last updated" value={formatTime(summary.lastWorkedAt)} />
        <BeadMetaItem label="Status" value={bead.status} />
        <BeadMetaItem label="Type" value={bead.type} />
        <BeadMetaItem label="Priority" value={`P${bead.priority}`} />
        <BeadMetaItem label="Owner" value={bead.owner ?? bead.assignee ?? ""} />
        <BeadMetaItem label="Created" value={formatTime(bead.created)} />
        <BeadMetaItem label="Updated" value={formatTime(bead.updated)} />
      </div>

      {bead.labels && bead.labels.length > 0 ? (
        <section className="rounded border border-border/50 bg-muted/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Labels</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {bead.labels.map((label) => (
              <Badge key={label} variant="outline" className="text-[10px] font-normal">
                {label}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {renderLongText("Description", bead.description)}
      {renderLongText("Acceptance", bead.acceptance)}
      {renderLongText("Notes", bead.notes)}
    </div>
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
      RECENT_HOURS,
    ],
    queryFn: () =>
      fetchAgentHistory({
        repoPath: activeRepo ?? undefined,
        beadId: selectedBead?.beadId,
        beadRepoPath: selectedBead?.repoPath,
        sinceHours: RECENT_HOURS,
      }),
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
  });

  const beats = useMemo(() => {
    if (!historyQuery.data?.ok) return [];
    return (historyQuery.data.data?.beats ?? []).filter((beat) => isRecent(beat.lastWorkedAt, RECENT_HOURS));
  }, [historyQuery.data]);

  useEffect(() => {
    if (beats.length === 0) {
      if (selectedBeadKey !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Selection is synchronized to currently available recent beat list.
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

  const detailQuery = useQuery({
    queryKey: ["agent-history-bead-detail", selectedSummary?.repoPath ?? null, selectedSummary?.beadId ?? null],
    queryFn: () => fetchBead(selectedSummary!.beadId, selectedSummary!.repoPath),
    enabled: Boolean(selectedSummary),
    refetchInterval: 10_000,
  });

  const beadDetail = detailQuery.data?.ok ? detailQuery.data.data ?? null : null;

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
      <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
        Add a repository to view agent history.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <aside
          className="rounded-lg border border-border/70 bg-card"
          style={{ height: `${TOP_PANEL_HEIGHT_PX}px` }}
        >
          <div className="border-b border-border/60 px-3 py-2" style={{ height: `${TOP_PANEL_HEADER_HEIGHT_PX}px` }}>
            <p className="text-xs font-semibold">Recent Take!/Scene Beats</p>
            <p className="text-[11px] text-muted-foreground">
              Last {RECENT_HOURS}h, newest first. Showing {TITLE_VISIBLE_COUNT} at a time.
            </p>
          </div>

          <div style={{ height: `${TITLE_VISIBLE_COUNT * TITLE_ROW_HEIGHT_PX}px` }} className="overflow-y-auto">
            {historyQuery.isLoading ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">Loading history...</div>
            ) : historyQuery.data && !historyQuery.data.ok ? (
              <div className="px-3 py-4 text-xs text-destructive">
                {historyQuery.data.error ?? "Failed to load history"}
              </div>
            ) : beats.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                No beats with Take!/Scene activity in the last 24 hours.
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
                    style={{ minHeight: `${TITLE_ROW_HEIGHT_PX}px` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium">
                        {beat.title?.trim() || beat.beadId}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {relativeTime(beat.lastWorkedAt)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{beat.beadId}</span>
                      {showRepoName ? (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {repoNames.get(beat.repoPath) ?? beat.repoPath}
                        </Badge>
                      ) : null}
                      <span>Last updated {formatTime(beat.lastWorkedAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section
          className="rounded-lg border border-border/70 bg-card"
          style={{ height: `${TOP_PANEL_HEIGHT_PX}px` }}
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2" style={{ height: `${TOP_PANEL_HEADER_HEIGHT_PX}px` }}>
            <FileText className="size-3.5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">
                {selectedSummary ? selectedSummary.title?.trim() || selectedSummary.beadId : "Beat details"}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {selectedSummary
                  ? `Last updated ${formatTime(selectedSummary.lastWorkedAt)}`
                  : "Select a beat from the left"}
              </p>
            </div>
            {selectedSummary ? (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{selectedSummary.beadId}</span>
            ) : null}
          </div>

          <div className="overflow-y-auto p-3" style={{ height: `${TITLE_VISIBLE_COUNT * TITLE_ROW_HEIGHT_PX}px` }}>
            {!selectedSummary ? (
              <div className="rounded border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
                Select a beat to inspect details.
              </div>
            ) : detailQuery.isLoading ? (
              <div className="rounded border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
                Loading beat details...
              </div>
            ) : detailQuery.data && !detailQuery.data.ok ? (
              <div className="rounded border border-dashed border-destructive/40 px-3 py-6 text-center text-[11px] text-destructive">
                {detailQuery.data.error ?? "Failed to load beat details"}
              </div>
            ) : (
              <BeadDetailContent bead={beadDetail} summary={selectedSummary} />
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-700 bg-[#05070f] text-slate-100">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-2">
          <TerminalSquare className="size-3.5 text-slate-300" />
          <p className="text-xs font-semibold text-slate-100">Conversation Log</p>
          {selectedSummary ? (
            <span className="font-mono text-[10px] text-slate-400">{selectedSummary.beadId}</span>
          ) : null}
          {selectedSummary ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
              <Clock3 className="size-3" />
              Last updated {relativeTime(selectedSummary.lastWorkedAt)}
            </span>
          ) : null}
        </div>

        <div className="max-h-[calc(100vh-520px)] overflow-y-auto p-3">
          {!selectedSummary ? (
            <div className="rounded border border-dashed border-slate-700 px-4 py-8 text-center text-[11px] text-slate-400">
              Select a beat from the top-left list to inspect app and agent logs.
            </div>
          ) : historyQuery.isFetching && payloadSelectedKey !== selectedBeadKey ? (
            <div className="rounded border border-dashed border-slate-700 px-4 py-8 text-center text-[11px] text-slate-400">
              Loading logs for {selectedSummary.beadId}...
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded border border-dashed border-slate-700 px-4 py-8 text-center text-[11px] text-slate-400">
              No captured log sessions for this beat yet.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <Workflow className="size-3.5" />
                <Sparkles className="size-3.5" />
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
