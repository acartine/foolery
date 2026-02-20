"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { fetchBeads, updateBead } from "@/lib/api";
import { naturalCompare } from "@/lib/bead-sort";
import { useAppStore } from "@/stores/app-store";
import { toast } from "sonner";
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { RetakeDialog } from "@/components/retake-dialog";
import { BeadTypeBadge } from "@/components/bead-type-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
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
function extractCommitSha(bead: Bead): string | undefined {
  const label = bead.labels?.find((l) => l.startsWith("commit:"));
  return label ? label.slice("commit:".length) : undefined;
}

function RetakeRow({
  bead,
  onRetake,
  onTitleClick,
}: {
  bead: Bead;
  onRetake: (bead: Bead) => void;
  onTitleClick?: (bead: Bead) => void;
}) {
  const labels = bead.labels ?? [];
  const waveSlug = extractWaveSlug(labels);
  const isOrchestrated = labels.some(isWaveLabel);
  const visibleLabels = labels.filter((l) => !isInternalLabel(l));
  const commitSha = extractCommitSha(bead);

  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-2 py-2.5 hover:bg-muted/30">
      {/* Left: bead info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <BeadPriorityBadge priority={bead.priority} />
          <BeadTypeBadge type={bead.type} />
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
  const [retakeBead, setRetakeBead] = useState<Bead | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["beads", "retakes", activeRepo, registeredRepos.length],
    queryFn: async () => {
      const params: Record<string, string> = { status: "closed" };
      if (activeRepo) {
        const result = await fetchBeads(params, activeRepo);
        if (result.ok && result.data) {
          const repo = registeredRepos.find((r) => r.path === activeRepo);
          result.data = result.data.map((bead) => ({
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
            const result = await fetchBeads(params, repo.path);
            if (!result.ok || !result.data) return [];
            return result.data.map((bead) => ({
              ...bead,
              _repoPath: repo.path,
              _repoName: repo.name,
            }));
          })
        );
        return { ok: true as const, data: results.flat() };
      }
      return fetchBeads(params);
    },
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  // Sort closed beads by updated timestamp descending (most recent first),
  // with natural ID order as tiebreaker for deterministic sibling ordering.
  const beads = useMemo<Bead[]>(() => {
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
    mutationFn: async ({ bead, notes }: { bead: Bead; notes: string }) => {
      const commitSha = extractCommitSha(bead);
      const labels: string[] = [];
      if (commitSha) labels.push(`regression:${commitSha}`);

      const fields: UpdateBeadInput = {
        status: "in_progress",
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

  const handleOpenRetake = useCallback((bead: Bead) => {
    setRetakeBead(bead);
    setDialogOpen(true);
  }, []);

  const handleConfirmRetake = useCallback(
    (notes: string) => {
      if (retakeBead) handleRetake({ bead: retakeBead, notes });
    },
    [retakeBead, handleRetake]
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
        Failed to load closed beats.
      </div>
    );
  }

  if (beads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">No closed beats found.</p>
        <p className="mt-1 text-xs">Closed beats will appear here for regression tracking.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-2">
        <div className="text-xs text-muted-foreground">
          {beads.length} closed beat{beads.length !== 1 ? "s" : ""} — most recently updated first
        </div>
      </div>
      <div className="rounded-md border border-border/60">
        {paginatedBeads.map((bead) => (
          <RetakeRow key={bead.id} bead={bead} onRetake={handleOpenRetake} />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-between px-2">
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
      )}
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
