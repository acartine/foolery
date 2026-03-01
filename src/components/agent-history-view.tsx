"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ArrowDown,
  ArrowUp,
  Clock3,
  CornerDownLeft,
  FileText,
  Loader2,
  MessageSquareText,
  Sparkles,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import { fetchBead } from "@/lib/api";
import type {
  AgentHistoryBeatSummary,
  AgentHistoryEntry,
  AgentHistoryInteractionType,
  AgentHistorySession,
} from "@/lib/agent-history-types";
import { fetchAgentHistory } from "@/lib/agent-history-api";
import { formatModelDisplay } from "@/hooks/use-agent-info";
import type { Beat } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { Badge } from "@/components/ui/badge";
import {
  InteractionPicker,
  useInteractionPicker,
} from "@/components/interaction-picker";

const WINDOW_SIZE = 5;
const TITLE_ROW_HEIGHT_PX = 48;
const TOP_PANEL_HEADER_HEIGHT_PX = 62;
const TOP_PANEL_HEIGHT_PX = WINDOW_SIZE * TITLE_ROW_HEIGHT_PX + TOP_PANEL_HEADER_HEIGHT_PX;
const CACHE_MAX = 10;

function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

function beatKey(beatId: string, repoPath: string): string {
  return `${repoPath}::${beatId}`;
}

function parseBeatKey(value: string | null): { beatId: string; repoPath: string } | null {
  if (!value) return null;
  const pivot = value.lastIndexOf("::");
  if (pivot <= 0) return null;
  const repoPath = value.slice(0, pivot);
  const beatId = value.slice(pivot + 2);
  if (!repoPath || !beatId) return null;
  return { beatId, repoPath };
}

function parseMillis(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
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
  if (source === "verification_review") return "Verification prompt";
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

function interactionTypeTone(interactionType: AgentHistorySession["interactionType"]): string {
  if (interactionType === "scene") {
    return "border-violet-500/40 bg-violet-500/20 text-violet-100";
  }
  if (interactionType === "verification") {
    return "border-amber-500/40 bg-amber-500/20 text-amber-100";
  }
  return "border-cyan-500/40 bg-cyan-500/20 text-cyan-100";
}

function interactionTypeLabel(interactionType: AgentHistorySession["interactionType"]): string {
  if (interactionType === "scene") return "Scene!";
  if (interactionType === "verification") return "Auto-review";
  return "Take!";
}

function BeatMetaItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="px-0.5 py-0.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-[10px]">{value?.trim() || "—"}</p>
    </div>
  );
}

function SessionEntryRow({
  entry,
  agentLabel,
  interactionType,
  precedingPromptSource,
}: {
  entry: AgentHistoryEntry;
  agentLabel?: string;
  interactionType?: AgentHistoryInteractionType;
  precedingPromptSource?: string;
}) {
  if (entry.kind === "session_start") {
    return (
      <div className="rounded border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-[10px] text-slate-300">
        Session started at {formatTime(entry.ts)}
      </div>
    );
  }

  if (entry.kind === "session_end") {
    return (
      <div className="rounded border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-[10px] text-slate-300">
        Session ended at {formatTime(entry.ts)}
        {entry.status ? ` · ${entry.status}` : ""}
        {entry.exitCode !== undefined ? ` · exit ${entry.exitCode}` : ""}
      </div>
    );
  }

  if (entry.kind === "prompt") {
    return (
      <div className="rounded border border-sky-500/50 bg-sky-950/35 px-2.5 py-1.5">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[9px] text-sky-200">
          <MessageSquareText className="size-3.5" />
          <span className="font-semibold uppercase tracking-wide">App -&gt; Agent{agentLabel ? ` · ${agentLabel}` : ""}</span>
          <Badge variant="outline" className="border-sky-400/40 bg-sky-900/40 text-[10px] font-normal text-sky-100">
            {promptSourceLabel(entry.promptSource)}
          </Badge>
          <span>{formatTime(entry.ts)}</span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-sky-100">
          {entry.prompt ?? "(empty prompt)"}
        </pre>
      </div>
    );
  }

  const raw = entry.raw ?? "";
  const summary = summarizeResponse(raw);
  const showRaw = raw.trim().length > 0 && summary.trim() !== raw.trim();

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60 px-2.5 py-1.5">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[9px] text-slate-300">
        <Bot className="size-3.5" />
        <span className="font-semibold uppercase tracking-wide text-slate-100">Agent{agentLabel ? ` · ${agentLabel}` : ""} -&gt; App</span>
        {interactionType ? (
          <Badge variant="outline" className={`text-[10px] font-normal ${interactionTypeTone(interactionType)}`}>
            {interactionTypeLabel(interactionType)}
          </Badge>
        ) : null}
        {precedingPromptSource ? (
          <Badge variant="outline" className="border-slate-500/40 bg-slate-800/40 text-[10px] font-normal text-slate-300">
            {promptSourceLabel(precedingPromptSource)}
          </Badge>
        ) : null}
        <span>{formatTime(entry.ts)}</span>
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-slate-100">
        {summary || "(empty response)"}
      </pre>
      {showRaw ? (
        <details className="mt-1.5 rounded border border-slate-700 bg-black/40 px-2 py-1 text-[9px]">
          <summary className="cursor-pointer text-slate-400">Raw event</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[9px] leading-5 text-slate-200">
            {clipDisplay(raw, 16_000)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function buildAgentLabel(session: AgentHistorySession): string | undefined {
  const parts: string[] = [];
  if (session.agentName) parts.push(session.agentName);
  const modelDisplay = formatModelDisplay(session.agentModel);
  if (modelDisplay) parts.push(modelDisplay);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function SessionCard({
  session,
  entryRefCallback,
  highlightedEntryId,
  filterEntry,
}: {
  session: AgentHistorySession;
  entryRefCallback?: (id: string, node: HTMLDivElement | null) => void;
  highlightedEntryId?: string | null;
  filterEntry?: (entry: AgentHistoryEntry) => boolean;
}) {
  const agentLabel = useMemo(() => buildAgentLabel(session), [session]);

  const enrichedEntries = useMemo(() => {
    const result: Array<{ entry: AgentHistoryEntry; precedingPromptSource?: string }> = [];
    let tracking: string | undefined;
    for (const entry of session.entries) {
      result.push({
        entry,
        precedingPromptSource: entry.kind === "response" ? tracking : undefined,
      });
      if (entry.kind === "prompt") {
        tracking = entry.promptSource;
      }
    }
    return result;
  }, [session.entries]);

  const filteredEntries = useMemo(() => {
    if (!filterEntry) return enrichedEntries;
    return enrichedEntries.filter(({ entry }) => filterEntry(entry));
  }, [enrichedEntries, filterEntry]);

  return (
    <section className="rounded border border-slate-700 bg-[#0b1020]">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-2.5 py-1.5">
        <Badge
          variant="outline"
          className={`text-[10px] uppercase ${interactionTypeTone(session.interactionType)}`}
        >
          {interactionTypeLabel(session.interactionType)}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${statusTone(session.status)}`}>
          {session.status ?? "unknown"}
        </Badge>
        {agentLabel ? (
          <span className="font-mono text-[10px] text-slate-300">{agentLabel}</span>
        ) : null}
        <span className="font-mono text-[10px] text-slate-400">{session.sessionId}</span>
        <span className="ml-auto text-[10px] text-slate-400">{formatTime(session.updatedAt)}</span>
      </header>
      <div className="space-y-1.5 p-2.5">
        {filteredEntries.length === 0 ? (
          <div className="rounded border border-slate-700 bg-slate-900/70 px-2.5 py-1.5 text-[10px] text-slate-300">
            {enrichedEntries.length === 0
              ? "No log entries captured for this session."
              : "No entries match the active filters."}
          </div>
        ) : (
          filteredEntries.map(({ entry, precedingPromptSource }) => (
            <div
              key={entry.id}
              ref={(node) => entryRefCallback?.(entry.id, node)}
              className={
                highlightedEntryId === entry.id
                  ? "rounded ring-2 ring-sky-400/70 transition-all duration-300"
                  : "transition-all duration-300"
              }
            >
              <SessionEntryRow
                entry={entry}
                agentLabel={agentLabel}
                interactionType={session.interactionType}
                precedingPromptSource={precedingPromptSource}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function renderLongText(label: string, value?: string) {
  if (!value?.trim()) return null;
  return (
    <section className="px-0.5 py-0.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-foreground">
        {value}
      </pre>
    </section>
  );
}

function BeatDetailContent({ beat, summary }: { beat: Beat | null; summary: AgentHistoryBeatSummary }) {
  if (!beat) {
    return (
      <div className="px-0.5 py-2 text-center text-[10px] text-muted-foreground">
        Beat details are unavailable for this repository entry.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <BeatMetaItem label="Beat ID" value={beat.id} />
        <BeatMetaItem label="Last updated" value={formatTime(summary.lastWorkedAt)} />
        <BeatMetaItem label="State" value={beat.state} />
        <BeatMetaItem label="Type" value={beat.type} />
        <BeatMetaItem label="Priority" value={`P${beat.priority}`} />
        <BeatMetaItem label="Owner" value={beat.owner ?? beat.assignee ?? ""} />
        <BeatMetaItem label="Created" value={formatTime(beat.created)} />
        <BeatMetaItem label="Updated" value={formatTime(beat.updated)} />
      </div>

      {beat.labels && beat.labels.length > 0 ? (
        <section className="px-0.5 py-0.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Labels</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {beat.labels.map((label) => (
              <Badge key={label} variant="outline" className="text-[10px] font-normal">
                {label}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {renderLongText("Description", beat.description)}
      {renderLongText("Acceptance", beat.acceptance)}
      {renderLongText("Notes", beat.notes)}
    </div>
  );
}

export function AgentHistoryView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const queryClient = useQueryClient();
  const [focusedBeatKey, setFocusedBeatKey] = useState<string | null>(null);
  const [loadedBeatKey, setLoadedBeatKey] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState(0);
  const beatButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const beatListRef = useRef<HTMLDivElement | null>(null);
  const consolePanelRef = useRef<HTMLDivElement | null>(null);
  const cachedBeatKeysRef = useRef<string[]>([]);
  const lastScrollDirectionRef = useRef<1 | -1>(1);

  const loadedBeat = useMemo(() => parseBeatKey(loadedBeatKey), [loadedBeatKey]);

  const beatsQuery = useQuery({
    queryKey: ["agent-history", "beats", activeRepo],
    queryFn: () =>
      fetchAgentHistory({
        repoPath: activeRepo ?? undefined,
      }),
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
  });

  const beats = useMemo(() => {
    if (!beatsQuery.data?.ok) return [];
    return (beatsQuery.data.data?.beats ?? [])
      .sort((a, b) => parseMillis(b.lastWorkedAt) - parseMillis(a.lastWorkedAt));
  }, [beatsQuery.data]);

  const visibleBeats = useMemo(
    () => beats.slice(windowStart, windowStart + WINDOW_SIZE),
    [beats, windowStart],
  );

  /* Keep focus and loaded in sync with beat list membership */
  useEffect(() => {
    if (beats.length === 0) {
      if (focusedBeatKey !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Focus and loaded selections must stay in sync with filtered beat list membership.
        setFocusedBeatKey(null);
      }
      if (loadedBeatKey !== null) {
        setLoadedBeatKey(null);
      }
      setWindowStart(0);
      return;
    }

    const focusedStillPresent =
      focusedBeatKey !== null &&
      beats.some((beat) => beatKey(beat.beadId, beat.repoPath) === focusedBeatKey);
    if (!focusedStillPresent) {
      setFocusedBeatKey(beatKey(beats[0].beadId, beats[0].repoPath));
    }

    const loadedStillPresent =
      loadedBeatKey === null ||
      beats.some((beat) => beatKey(beat.beadId, beat.repoPath) === loadedBeatKey);
    if (!loadedStillPresent) {
      setLoadedBeatKey(null);
    }
  }, [beats, focusedBeatKey, loadedBeatKey]);

  /* Keep window aligned with focused beat */
  useEffect(() => {
    if (!focusedBeatKey || beats.length === 0) return;
    const idx = beats.findIndex((b) => beatKey(b.beadId, b.repoPath) === focusedBeatKey);
    if (idx < 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Window position must stay in sync with focused beat index after beats list changes.
    setWindowStart((prev) => {
      if (idx < prev) return idx;
      if (idx >= prev + WINDOW_SIZE) return Math.max(0, idx - WINDOW_SIZE + 1);
      const maxStart = Math.max(0, beats.length - WINDOW_SIZE);
      return Math.min(prev, maxStart);
    });
  }, [focusedBeatKey, beats]);

  useEffect(() => {
    if (!focusedBeatKey) return;
    const node = beatButtonRefs.current[focusedBeatKey];
    if (!node) return;
    node.scrollIntoView({ block: "nearest" });
  }, [focusedBeatKey]);

  const moveFocusedBeat = useCallback(
    (direction: -1 | 1) => {
      if (beats.length === 0) return;
      lastScrollDirectionRef.current = direction;
      const currentIndex = focusedBeatKey
        ? beats.findIndex((beat) => beatKey(beat.beadId, beat.repoPath) === focusedBeatKey)
        : -1;
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + direction + beats.length) % beats.length;
      setFocusedBeatKey(beatKey(beats[nextIndex].beadId, beats[nextIndex].repoPath));
    },
    [beats, focusedBeatKey],
  );

  const focusedSummary = useMemo<AgentHistoryBeatSummary | null>(
    () =>
      focusedBeatKey
        ? beats.find((beat) => beatKey(beat.beadId, beat.repoPath) === focusedBeatKey) ?? null
        : null,
    [beats, focusedBeatKey],
  );

  const loadedSummary = useMemo<AgentHistoryBeatSummary | null>(
    () =>
      loadedBeatKey
        ? beats.find((beat) => beatKey(beat.beadId, beat.repoPath) === loadedBeatKey) ?? null
        : null,
    [beats, loadedBeatKey],
  );

  const focusConsolePanel = useCallback(() => {
    consolePanelRef.current?.focus();
  }, []);

  /* Fetch beat details for all visible beats */
  const detailQueries = useQueries({
    queries: visibleBeats.map((beat) => ({
      queryKey: ["agent-history-beat-detail", beat.repoPath, beat.beadId] as const,
      queryFn: () => fetchBead(beat.beadId, beat.repoPath),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });

  const beatDetailMap = useMemo(() => {
    const map = new Map<string, Beat>();
    for (let i = 0; i < detailQueries.length; i++) {
      const q = detailQueries[i];
      const beat = visibleBeats[i];
      if (q?.data?.ok && q.data.data && beat) {
        map.set(beatKey(beat.beadId, beat.repoPath), q.data.data);
      }
    }
    return map;
  }, [detailQueries, visibleBeats]);

  /* Focused beat detail state for the right panel */
  const focusedDetail = useMemo(() => {
    if (!focusedBeatKey) return { loading: false, error: null as string | null, beat: null as Beat | null };
    const idx = visibleBeats.findIndex((b) => beatKey(b.beadId, b.repoPath) === focusedBeatKey);
    if (idx < 0) return { loading: false, error: null, beat: null };
    const q = detailQueries[idx];
    if (q.isLoading) return { loading: true, error: null, beat: null };
    if (q.data && !q.data.ok) return { loading: false, error: q.data.error ?? "Failed to load", beat: null };
    return { loading: false, error: null, beat: q.data?.data ?? null };
  }, [focusedBeatKey, visibleBeats, detailQueries]);

  /* Pre-cache next batch of beats when focus is near bottom of window */
  useEffect(() => {
    const focusedIndexInWindow = focusedBeatKey
      ? visibleBeats.findIndex((b) => beatKey(b.beadId, b.repoPath) === focusedBeatKey)
      : -1;
    if (focusedIndexInWindow < Math.floor(WINDOW_SIZE / 2)) return;

    const prefetchStart = windowStart + WINDOW_SIZE;
    const prefetchEnd = Math.min(beats.length, prefetchStart + WINDOW_SIZE);
    for (let i = prefetchStart; i < prefetchEnd; i++) {
      const beat = beats[i];
      void queryClient.prefetchQuery({
        queryKey: ["agent-history-beat-detail", beat.repoPath, beat.beadId],
        queryFn: () => fetchBead(beat.beadId, beat.repoPath),
        staleTime: 60_000,
      });
    }
  }, [windowStart, focusedBeatKey, beats, visibleBeats, queryClient]);

  /* Cache eviction: keep at most CACHE_MAX beat detail queries */
  useEffect(() => {
    const cached = cachedBeatKeysRef.current;
    for (const beat of visibleBeats) {
      const key = beatKey(beat.beadId, beat.repoPath);
      const idx = cached.indexOf(key);
      if (idx >= 0) cached.splice(idx, 1);
      cached.push(key);
    }
    while (cached.length > CACHE_MAX) {
      const direction = lastScrollDirectionRef.current;
      const evicted = direction === 1 ? cached.shift()! : cached.pop()!;
      const parsed = parseBeatKey(evicted);
      if (parsed) {
        queryClient.removeQueries({
          queryKey: ["agent-history-beat-detail", parsed.repoPath, parsed.beatId],
        });
      }
    }
  }, [visibleBeats, queryClient]);

  const sessionsQuery = useQuery({
    queryKey: [
      "agent-history",
      "sessions",
      activeRepo,
      loadedBeat?.repoPath ?? null,
      loadedBeat?.beatId ?? null,
    ],
    queryFn: () =>
      fetchAgentHistory({
        repoPath: activeRepo ?? undefined,
        beatId: loadedBeat!.beatId,
        beatRepoPath: loadedBeat!.repoPath,
      }),
    enabled: Boolean(loadedBeat),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const sessions = useMemo(() => {
    if (!sessionsQuery.data?.ok) return [];
    return sessionsQuery.data.data?.sessions ?? [];
  }, [sessionsQuery.data]);

  const picker = useInteractionPicker(sessions);

  const repoNames = useMemo(
    () =>
      new Map(
        registeredRepos.map((repo) => [repo.path, repo.name]),
      ),
    [registeredRepos],
  );

  const showRepoName = !activeRepo && registeredRepos.length > 1;

  const getBeatTitle = useCallback(
    (summary: AgentHistoryBeatSummary | null): string => {
      if (!summary) return "";
      const hinted = summary.title?.trim();
      if (hinted) return hinted;
      const key = beatKey(summary.beadId, summary.repoPath);
      const detail = beatDetailMap.get(key);
      if (detail?.title?.trim()) return detail.title.trim();
      return summary.beadId;
    },
    [beatDetailMap],
  );

  const focusedTitle = focusedSummary ? getBeatTitle(focusedSummary) : "Beat details";
  const loadedTitle = loadedSummary ? getBeatTitle(loadedSummary) : null;

  if (!activeRepo && registeredRepos.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
        Add a repository to view agent history.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <aside
          className="rounded-lg border border-slate-300/80 bg-slate-50/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/30"
          style={{ height: `${TOP_PANEL_HEIGHT_PX}px` }}
        >
          <div className="border-b border-border/60 px-2.5 py-1.5" style={{ height: `${TOP_PANEL_HEADER_HEIGHT_PX}px` }}>
            <p className="text-xs font-semibold">Recent Take!/Scene Beats</p>
            <p className="text-[10px] text-muted-foreground">
              {beats.length > 0
                ? `Showing ${windowStart + 1}–${Math.min(windowStart + WINDOW_SIZE, beats.length)} of ${beats.length}, newest first.`
                : "Newest first."}
            </p>
            <div className="mt-1 inline-flex items-center gap-2 text-[9px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><ArrowUp className="size-3" />/<ArrowDown className="size-3" /> navigate</span>
              <span className="inline-flex items-center gap-1"><CornerDownLeft className="size-3" />/<span className="text-[8px] font-semibold">Space</span> load logs</span>
              <span className="inline-flex items-center gap-1"><span className="text-[8px] font-semibold">Tab</span> console focus</span>
            </div>
          </div>

          <div
            ref={beatListRef}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveFocusedBeat(1);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveFocusedBeat(-1);
                return;
              }
              if (event.key === "Enter" && focusedBeatKey) {
                event.preventDefault();
                setLoadedBeatKey(focusedBeatKey);
                focusConsolePanel();
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                focusConsolePanel();
              }
              if (event.key === " ") {
                event.preventDefault();
                if (focusedBeatKey) {
                  setLoadedBeatKey(focusedBeatKey);
                }
                return;
              }
            }}
            style={{ height: `${WINDOW_SIZE * TITLE_ROW_HEIGHT_PX}px` }}
            className="overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-sky-500/70"
          >
            {beatsQuery.isLoading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>Loading history… prompt histories are BIG, please be patient :-)</span>
              </div>
            ) : beatsQuery.data && !beatsQuery.data.ok ? (
              <div className="px-2.5 py-3 text-xs text-destructive">
                {beatsQuery.data.error ?? "Failed to load history"}
              </div>
            ) : beats.length === 0 ? (
              <div className="px-2.5 py-3 text-xs text-muted-foreground">
                No beats with Take!/Scene activity.
              </div>
            ) : (
              visibleBeats.map((beat) => {
                const key = beatKey(beat.beadId, beat.repoPath);
                const focused = focusedBeatKey === key;
                const loaded = loadedBeatKey === key;
                return (
                  <button
                    type="button"
                    key={key}
                    ref={(node) => {
                      beatButtonRefs.current[key] = node;
                    }}
                    onClick={() => {
                      setFocusedBeatKey(key);
                      setLoadedBeatKey(key);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Tab") {
                        event.preventDefault();
                        focusConsolePanel();
                      }
                    }}
                    tabIndex={-1}
                    className={`relative block w-full border-b border-border/50 px-2.5 py-1.5 text-left transition-colors ${
                      loaded
                        ? "border-l-4 border-l-cyan-500 bg-cyan-100/95 text-cyan-950 shadow-inner dark:bg-cyan-900/60 dark:text-cyan-100"
                        : focused
                          ? "border-l-4 border-l-sky-500 bg-sky-100/75 text-sky-950 dark:bg-sky-900/35 dark:text-sky-100"
                        : "hover:bg-muted/40"
                    }`}
                    style={{ minHeight: `${TITLE_ROW_HEIGHT_PX}px` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium">
                        {getBeatTitle(beat)}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {relativeTime(beat.lastWorkedAt)}
                      </span>
                    </div>
                    <div className={`mt-0.5 flex flex-wrap items-center gap-1 text-[9px] ${
                      loaded
                        ? "text-cyan-800 dark:text-cyan-200"
                        : focused
                          ? "text-sky-800 dark:text-sky-200"
                          : "text-muted-foreground"
                    }`}>
                      <span className="font-mono">{beat.beadId}</span>
                      {showRepoName ? (
                        <Badge variant="outline" className="text-[9px] font-normal">
                          {repoNames.get(beat.repoPath) ?? beat.repoPath}
                        </Badge>
                      ) : null}
                      {loaded ? (
                        <Badge variant="outline" className="border-cyan-400/60 text-[9px] font-normal">
                          loaded
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
          className="rounded-lg border border-slate-300/80 bg-slate-50/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/30"
          style={{ height: `${TOP_PANEL_HEIGHT_PX}px` }}
        >
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5" style={{ height: `${TOP_PANEL_HEADER_HEIGHT_PX}px` }}>
            <FileText className="size-3.5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">
                {focusedTitle}
              </p>
              <p className="truncate text-[9px] text-muted-foreground">
                {focusedSummary
                  ? `Last updated ${formatTime(focusedSummary.lastWorkedAt)}`
                  : "Select a beat from the left"}
              </p>
            </div>
            {focusedSummary ? (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{focusedSummary.beadId}</span>
            ) : null}
          </div>

          <div className="overflow-y-auto p-2" style={{ height: `${WINDOW_SIZE * TITLE_ROW_HEIGHT_PX}px` }}>
            {!focusedSummary ? (
              <div className="px-0.5 py-2 text-center text-[10px] text-muted-foreground">
                Select a beat to inspect details.
              </div>
            ) : focusedDetail.loading ? (
              <div className="flex items-center justify-center gap-1.5 px-0.5 py-2 text-[10px] text-muted-foreground">
                <Spinner className="size-3" />
                <span>Loading beat details…</span>
              </div>
            ) : focusedDetail.error ? (
              <div className="px-0.5 py-2 text-center text-[10px] text-destructive">
                {focusedDetail.error}
              </div>
            ) : (
              <BeatDetailContent beat={focusedDetail.beat} summary={focusedSummary} />
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-700 bg-[#05070f] text-slate-100">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-2.5 py-1.5">
          <TerminalSquare className="size-3.5 text-slate-300" />
          <p className="text-xs font-semibold text-slate-100">Conversation Log</p>
          {loadedSummary ? (
            <span className="max-w-[40ch] truncate text-[10px] text-slate-200">
              {loadedTitle}
            </span>
          ) : null}
          {loadedSummary ? (
            <span className="font-mono text-[10px] text-slate-400">{loadedSummary.beadId}</span>
          ) : null}
          {loadedSummary ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
              <Clock3 className="size-3" />
              Last updated {relativeTime(loadedSummary.lastWorkedAt)}
            </span>
          ) : null}
        </div>

        {loadedSummary && sessions.length > 0 ? (
          <InteractionPicker picker={picker} />
        ) : null}

        <div
          ref={consolePanelRef}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Tab" && event.shiftKey) {
              event.preventDefault();
              beatListRef.current?.focus();
            }
          }}
          className="max-h-[calc(100vh-500px)] overflow-y-auto p-2.5 outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/60"
        >
          {!loadedSummary ? (
            <div className="rounded border border-dashed border-slate-700 px-3 py-6 text-center text-[10px] text-slate-400">
              Use click or Enter on a focused beat to load app and agent logs.
            </div>
          ) : sessionsQuery.isLoading && sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded border border-dashed border-slate-700 px-3 py-6 text-[10px] text-slate-400">
              <Spinner className="size-4" />
              <span>Loading logs for {loadedSummary.beadId}…</span>
              <span className="text-[9px]">prompt histories are BIG, please be patient :-)</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded border border-dashed border-slate-700 px-3 py-6 text-center text-[10px] text-slate-400">
              No captured log sessions for this beat yet.
            </div>
          ) : (
            <div className="space-y-2">
              {sessionsQuery.isFetching && !sessionsQuery.isLoading ? (
                <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
                  <Spinner className="size-3" />
                  <span>Refreshing…</span>
                </div>
              ) : null}
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <Workflow className="size-3.5" />
                <Sparkles className="size-3.5" />
                {sessions.length} session{sessions.length === 1 ? "" : "s"}
              </div>
              {sessions.map((session) => (
                <SessionCard
                  key={session.sessionId}
                  session={session}
                  entryRefCallback={picker.entryRefCallback}
                  highlightedEntryId={picker.highlightedEntryId}
                  filterEntry={picker.filterEntry}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
