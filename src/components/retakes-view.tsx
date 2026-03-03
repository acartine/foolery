"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { fetchBeads, fetchWorkflows, updateBead } from "@/lib/api";
import { naturalCompare } from "@/lib/beat-sort";
import { useAppStore } from "@/stores/app-store";
import { toast } from "sonner";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { RetakeDialog } from "@/components/retake-dialog";
import { BeatTypeBadge } from "@/components/beat-type-badge";
import { BeatPriorityBadge } from "@/components/beat-priority-badge";
import { isWaveLabel, extractWaveSlug, isInternalLabel } from "@/lib/wave-slugs";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateUrl } from "@/hooks/use-update-url";
import { beatInRetake, workflowDescriptorById } from "@/lib/workflows";

const LABEL_COLORS = [
  "bg-red-100 text-red-800",
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-yellow-100 text-yellow-800",
  "bg-purple-100 text-purple-800",
  "bg-pink-100 text-pink-800",
  "bg-indigo-100 text-indigo-800",
  "bg-orange-100 text-orange-800",
  "bg-teal-100 text-teal-800",
  "bg-cyan-100 text-cyan-800",
];

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Extract the commit sha from a bead's labels (commit:<sha>). */
function extractCommitSha(bead: Beat): string | undefined {
  const label = bead.labels?.find((l) => l.startsWith("commit:"));
  return label ? label.slice("commit:".length) : undefined;
}

type MetadataEntry = Record<string, unknown>;

const STEP_METADATA_KEYS = [
  "knotsSteps",
  "knots_steps",
  "knotsStepHistory",
  "knotsTimeline",
  "knotsTransitions",
  "stepHistory",
  "steps",
  "step_history",
  "timeline",
  "transitions",
] as const;

const NOTE_METADATA_KEYS = [
  "knotsNotes",
  "knots_notes",
  "notes",
  "noteHistory",
  "note_history",
] as const;
const HANDOFF_METADATA_KEYS = [
  "knotsHandoffCapsules",
  "knots_handoff_capsules",
  "handoff_capsules",
  "handoffCapsules",
  "handoff_capsule_history",
] as const;

function pickString(entry: MetadataEntry, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function readMetadataEntries(bead: Beat, keys: string[]): MetadataEntry[] {
  const metadata = bead.metadata;
  if (!metadata || typeof metadata !== "object") return [];

  for (const key of keys) {
    const raw = (metadata as Record<string, unknown>)[key];
    if (!Array.isArray(raw)) continue;
    return raw.filter((entry): entry is MetadataEntry => Boolean(entry && typeof entry === "object"));
  }

  return [];
}

function readMetadataString(bead: Beat, keys: string[]): string | undefined {
  const metadata = bead.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return pickString(metadata as MetadataEntry, keys);
}

function metadataEntryKey(entry: MetadataEntry, index: number): string {
  return pickString(entry, ["entry_id", "id", "step_id", "uuid"]) ?? String(index);
}

function pickObject(entry: MetadataEntry, keys: string[]): MetadataEntry | null {
  for (const key of keys) {
    const value = entry[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as MetadataEntry;
    }
  }
  return null;
}

function stepSummary(entry: MetadataEntry): string | undefined {
  const direct = pickString(entry, [
    "content",
    "summary",
    "description",
    "message",
    "note",
    "title",
    "details",
    "reason",
  ]);
  const from = pickString(entry, ["from_state", "fromState", "from", "prev_state", "previous_state"]);
  const to = pickString(entry, ["to_state", "toState", "to", "state", "next_state"]);
  const action = pickString(entry, ["action", "step", "event", "transition"]);
  const actorKind = pickString(entry, ["actor_kind", "actorKind", "owner_kind", "ownerKind"]);

  const parts: string[] = [];
  if (action) parts.push(action);
  if (from || to) parts.push(`${from ?? "?"} -> ${to ?? "?"}`);
  if (actorKind) parts.push(`actor:${actorKind}`);

  if (direct && parts.length === 0) return direct;
  if (!direct && parts.length === 0) return undefined;
  return direct ? `${direct}\n${parts.join(" · ")}` : parts.join(" · ");
}

function safeRelativeTime(value: string): string {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? value : relativeTime(value);
}

function ExpandableText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div
      className={className}
      onMouseEnter={() => {
        if (overflows) setExpanded(true);
      }}
      onMouseLeave={() => setExpanded(false)}
    >
      <div
        ref={ref}
        className={`whitespace-pre-wrap break-words text-xs ${expanded ? "" : "line-clamp-6"}`}
      >
        {text}
      </div>
      {!expanded && overflows && (
        <div className="mt-0.5 text-[10px] font-semibold text-green-700">Hover to expand</div>
      )}
    </div>
  );
}

function AgentBadge({ entry }: { entry: MetadataEntry }) {
  const metadata = pickObject(entry, ["metadata", "meta", "details"]);
  const agent =
    pickObject(entry, ["agent", "executor", "worker"]) ??
    (metadata ? pickObject(metadata, ["agent", "executor", "worker"]) : null);
  const user =
    pickObject(entry, ["user", "author", "created_by", "createdBy"]) ??
    (metadata ? pickObject(metadata, ["user", "author", "created_by", "createdBy"]) : null);
  const actor =
    pickObject(entry, ["actor", "updated_by", "updatedBy", "by"]) ??
    (metadata ? pickObject(metadata, ["actor", "updated_by", "updatedBy", "by"]) : null);

  const agentname =
    pickString(entry, ["agentname", "agentName", "agent_name"]) ??
    (metadata ? pickString(metadata, ["agentname", "agentName", "agent_name"]) : undefined) ??
    (agent ? pickString(agent, ["name", "agentname", "agentName", "agent_name"]) : undefined) ??
    "unknown-agent";

  const model =
    pickString(entry, ["model", "agentModel", "agent_model"]) ??
    (metadata ? pickString(metadata, ["model", "agentModel", "agent_model"]) : undefined) ??
    (agent ? pickString(agent, ["model", "agentModel", "agent_model"]) : undefined) ??
    "unknown-model";

  const username =
    pickString(entry, ["username", "user", "user_name", "actor", "actor_name"]) ??
    (metadata ? pickString(metadata, ["username", "user", "user_name", "actor", "actor_name"]) : undefined) ??
    (user ? pickString(user, ["name", "username", "login"]) : undefined) ??
    (actor ? pickString(actor, ["name", "username", "login"]) : undefined) ??
    "unknown-user";

  const version =
    pickString(entry, ["version", "agentVersion", "agent_version"]) ??
    (metadata ? pickString(metadata, ["version", "agentVersion", "agent_version"]) : undefined) ??
    (agent ? pickString(agent, ["version", "agentVersion", "agent_version"]) : undefined);

  const datetime = pickString(entry, [
    "datetime",
    "timestamp",
    "ts",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
    "time",
  ]) ??
    (metadata ? pickString(metadata, [
      "datetime",
      "timestamp",
      "ts",
      "created_at",
      "createdAt",
      "updated_at",
      "updatedAt",
      "time",
      "at",
      "occurred_at",
    ]) : undefined);

  return (
    <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium">{agentname}</span>
      <span className="text-muted-foreground/40">|</span>
      <span>{model}</span>
      {version ? (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span>{version}</span>
        </>
      ) : null}
      <span className="text-muted-foreground/40">|</span>
      <span>{username}</span>
      {datetime ? (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span>{safeRelativeTime(datetime)}</span>
        </>
      ) : null}
    </div>
  );
}

function RetakeDetails({ bead }: { bead: Beat }) {
  const description = bead.description ?? readMetadataString(bead, [
    "knotsDescription",
    "description",
    "body",
    "knotsBody",
  ]);
  const rawSteps = readMetadataEntries(bead, [...STEP_METADATA_KEYS]);
  const rawNotes = readMetadataEntries(bead, [...NOTE_METADATA_KEYS]);
  const rawCapsules = readMetadataEntries(bead, [...HANDOFF_METADATA_KEYS]);
  const noteEntries = rawNotes.length > 0
    ? rawNotes
    : bead.notes
      ? [{
          content: bead.notes,
          username: "legacy-notes",
          datetime: bead.updated,
        }]
      : [];

  const renderedSteps = rawSteps.flatMap((step, index) => {
    const content = stepSummary(step);
    if (!content) return [];
    return [{ entry: step, key: metadataEntryKey(step, index), content }];
  });

  const renderedNotes = noteEntries.flatMap((note, index) => {
    const content = pickString(note, ["content", "note", "message", "summary", "description"]);
    if (!content) return [];
    return [{ entry: note, key: metadataEntryKey(note, index), content }];
  });

  const renderedCapsules = rawCapsules.flatMap((capsule, index) => {
    const content = pickString(capsule, ["content", "summary", "message", "description", "note"]);
    if (!content) return [];
    return [{ entry: capsule, key: metadataEntryKey(capsule, index), content }];
  });

  if (!description && renderedSteps.length === 0 && renderedNotes.length === 0 && renderedCapsules.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {description && (
        <div className="rounded bg-green-50 px-2 py-1.5">
          <div className="text-[10px] font-semibold text-green-800 uppercase tracking-wide mb-0.5">
            Description
          </div>
          <ExpandableText text={description} />
        </div>
      )}

      {renderedSteps.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-700">
            Steps
          </div>
          {renderedSteps.map((step) => (
            <div key={step.key} className="rounded bg-slate-100 px-2 py-1.5">
              <AgentBadge entry={step.entry} />
              <ExpandableText text={step.content} />
            </div>
          ))}
        </div>
      )}

      {renderedNotes.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-yellow-800 uppercase tracking-wide">
            Notes
          </div>
          {renderedNotes.map((note) => (
            <div key={note.key} className="rounded bg-yellow-50 px-2 py-1.5">
              <AgentBadge entry={note.entry} />
              <ExpandableText text={note.content} />
            </div>
          ))}
        </div>
      )}

      {renderedCapsules.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-blue-800 uppercase tracking-wide">
            Handoff Capsules
          </div>
          {renderedCapsules.map((capsule) => (
            <div key={capsule.key} className="rounded bg-blue-50 px-2 py-1.5">
              <AgentBadge entry={capsule.entry} />
              <ExpandableText text={capsule.content} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RetakeRow({
  bead,
  onRetake,
  onTitleClick,
}: {
  bead: Beat;
  onRetake: (bead: Beat) => void;
  onTitleClick?: (bead: Beat) => void;
}) {
  const labels = bead.labels ?? [];
  const waveSlug = extractWaveSlug(labels);
  const isOrchestrated = labels.some(isWaveLabel);
  const visibleLabels = labels.filter((l) => !isInternalLabel(l));
  const commitSha = extractCommitSha(bead);

  return (
    <div className="flex items-start gap-3 border-b border-border/40 px-2 py-2.5 hover:bg-muted/30">
      {/* Left: bead info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <BeatPriorityBadge priority={bead.priority} />
          <BeatTypeBadge type={bead.type} />
          {onTitleClick ? (
            <button
              type="button"
              title="Open beat details"
              className="truncate text-sm font-medium text-left hover:underline"
              onClick={() => onTitleClick(bead)}
            >
              {waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}
              {bead.title}
            </button>
          ) : (
            <span className="truncate text-sm font-medium">
              {waveSlug && <span className="text-xs font-mono text-muted-foreground mr-1">[{waveSlug}]</span>}
              {bead.title}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-muted-foreground">{bead.id.replace(/^[^-]+-/, "")}</span>
          <span className="text-[11px] text-muted-foreground">{relativeTime(bead.updated)}</span>
          {commitSha && (
            <span className="inline-flex items-center rounded px-1 py-0 text-[10px] font-mono font-medium leading-none bg-slate-100 text-slate-700">
              {commitSha}
            </span>
          )}
          {isOrchestrated && (
            <span className="inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium leading-none bg-slate-100 text-slate-600">
              <Clapperboard className="size-2.5" />
              Orchestrated
            </span>
          )}
          {visibleLabels.map((label) => (
            <span
              key={label}
              className={`inline-flex items-center rounded px-1 py-0 text-[10px] font-medium leading-none ${labelColor(label)}`}
            >
              {label}
            </span>
          ))}
        </div>
        <RetakeDetails bead={bead} />
      </div>

      {/* Right: ReTake button */}
      <button
        type="button"
        className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
        title="Flag regression and reopen this bead"
        onClick={() => onRetake(bead)}
      >
        ReTake
      </button>
    </div>
  );
}

export function RetakesView() {
  const { activeRepo, registeredRepos, pageSize } = useAppStore();
  const queryClient = useQueryClient();
  const updateUrl = useUpdateUrl();
  const [retakeBead, setRetakeBead] = useState<Beat | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["beads", "retakes", activeRepo, registeredRepos.length],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (activeRepo) {
        const [result, workflowsResult] = await Promise.all([
          fetchBeads(params, activeRepo),
          fetchWorkflows(activeRepo),
        ]);
        if (result.ok && result.data) {
          const workflowsById = workflowDescriptorById(
            workflowsResult.ok ? workflowsResult.data ?? [] : [],
          );
          const repo = registeredRepos.find((r) => r.path === activeRepo);
          result.data = result.data
            .filter((bead) => beatInRetake(bead, workflowsById))
            .map((bead) => ({
              ...bead,
              _repoPath: activeRepo,
              _repoName: repo?.name ?? activeRepo,
            })) as typeof result.data;
        }
        return result;
      }
      if (registeredRepos.length > 0) {
        const results = await Promise.all(
          registeredRepos.map(async (repo) => {
            const [result, workflowsResult] = await Promise.all([
              fetchBeads(params, repo.path),
              fetchWorkflows(repo.path),
            ]);
            if (!result.ok || !result.data) return [];
            const workflowsById = workflowDescriptorById(
              workflowsResult.ok ? workflowsResult.data ?? [] : [],
            );
            return result.data
              .filter((bead) => beatInRetake(bead, workflowsById))
              .map((bead) => ({
                ...bead,
                _repoPath: repo.path,
                _repoName: repo.name,
              }));
          })
        );
        return { ok: true as const, data: results.flat() };
      }
      const [result, workflowsResult] = await Promise.all([
        fetchBeads(params),
        fetchWorkflows(),
      ]);
      if (result.ok && result.data) {
        const workflowsById = workflowDescriptorById(
          workflowsResult.ok ? workflowsResult.data ?? [] : [],
        );
        result.data = result.data.filter((bead) => beatInRetake(bead, workflowsById));
      }
      return result;
    },
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  // Sort closed beads by updated timestamp descending (most recent first),
  // with natural ID order as tiebreaker for deterministic sibling ordering.
  const beads = useMemo<Beat[]>(() => {
    if (!data?.ok || !data.data) return [];
    return [...data.data].sort((a, b) => {
      const timeDiff = new Date(b.updated).getTime() - new Date(a.updated).getTime();
      if (timeDiff !== 0) return timeDiff;
      return naturalCompare(a.id, b.id);
    });
  }, [data]);

  const pageCount = Math.max(1, Math.ceil(beads.length / pageSize));
  const paginatedBeads = useMemo(() => {
    const start = pageIndex * pageSize;
    return beads.slice(start, start + pageSize);
  }, [beads, pageIndex, pageSize]);

  // Reset page when data changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset pagination when dataset size changes; mirrors bead-table pattern.
    setPageIndex(0);
  }, [beads.length]);

  const { mutate: handleRetake, isPending: isRetaking } = useMutation({
    mutationFn: async ({ bead, notes }: { bead: Beat; notes: string }) => {
      const commitSha = extractCommitSha(bead);
      const labels: string[] = [];
      if (commitSha) labels.push(`regression:${commitSha}`);

      const fields: UpdateBeatInput = {
        state: "in_progress",
        labels: labels.length > 0 ? labels : undefined,
        notes: notes
          ? `${bead.notes ? bead.notes + "\n" : ""}ReTake: ${notes}`
          : bead.notes
            ? `${bead.notes}\nReTake: reopened for regression investigation`
            : "ReTake: reopened for regression investigation",
      };

      const repo = (bead as unknown as Record<string, unknown>)._repoPath as string | undefined;
      return updateBead(bead.id, fields, repo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      toast.success("ReTake initiated — bead reopened for investigation");
      setDialogOpen(false);
      setRetakeBead(null);
    },
    onError: () => {
      toast.error("Failed to initiate ReTake");
    },
  });

  const handleOpenRetake = useCallback((bead: Beat) => {
    setRetakeBead(bead);
    setDialogOpen(true);
  }, []);

  const handleConfirmRetake = useCallback(
    (notes: string) => {
      if (retakeBead) handleRetake({ bead: retakeBead, notes });
    },
    [retakeBead, handleRetake]
  );

  const renderPaginationControls = () => (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2">
      <div className="text-sm text-muted-foreground">
        Page {pageIndex + 1} of {pageCount}
      </div>
      <div className="flex items-center gap-1">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const size = Number(v);
            setPageIndex(0);
            updateUrl({ pageSize: size });
          }}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          title="Previous page"
          onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
          disabled={pageIndex === 0}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Next page"
          onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
          disabled={pageIndex >= pageCount - 1}
        >
          Next
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        Loading ReTakes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-destructive">
        Failed to load retake beats.
      </div>
    );
  }

  if (beads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">No beats in retake found.</p>
        <p className="mt-1 text-xs">Beats in retake will appear here for regression tracking.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-2">
        <div className="text-xs text-muted-foreground">
          {beads.length} beat{beads.length !== 1 ? "s" : ""} in retake — most recently updated first
        </div>
      </div>
      {pageCount > 1 && renderPaginationControls()}
      <div className="rounded-md border border-border/60">
        {paginatedBeads.map((bead) => (
          <RetakeRow key={bead.id} bead={bead} onRetake={handleOpenRetake} />
        ))}
      </div>
      {pageCount > 1 && renderPaginationControls()}
      <RetakeDialog
        bead={retakeBead}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={handleConfirmRetake}
        isPending={isRetaking}
      />
    </div>
  );
}
