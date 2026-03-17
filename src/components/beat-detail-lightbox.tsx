"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { fetchBeat, fetchDeps, fetchWorkflows, addDep } from "@/lib/api";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";
import { canTakeBeat } from "@/lib/beat-take-eligibility";
import { BeatDetail } from "@/components/beat-detail";
import { DepTree } from "@/components/dep-tree";
import { RelationshipPicker } from "@/components/relationship-picker";
import { MoveToProjectDialog } from "@/components/move-to-project-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BeatDetailLightboxProps {
  open: boolean;
  beatId: string | null;
  repo?: string;
  initialBeat?: Beat | null;
  onOpenChange: (open: boolean) => void;
  onMoved: (newId: string, targetRepo: string) => void;
  onShipBeat?: (beat: Beat) => void;
  isParentRollingBeat?: (beat: Beat) => boolean;
}

export function BeatDetailLightbox({
  open,
  beatId,
  repo,
  initialBeat,
  onOpenChange,
  onMoved,
  onShipBeat,
  isParentRollingBeat,
}: BeatDetailLightboxProps) {
  const [blocksIds, setBlocksIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const queryClient = useQueryClient();

  const detailId = beatId ?? "";

  const { data: beatData, isLoading: isLoadingBeat } = useQuery({
    queryKey: ["beat", detailId, repo],
    queryFn: () => fetchBeat(detailId, repo),
    enabled: open && detailId.length > 0,
    placeholderData: initialBeat ? { ok: true, data: initialBeat } : undefined,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const { data: depsData } = useQuery({
    queryKey: ["beat-deps", detailId, repo],
    queryFn: () => fetchDeps(detailId, repo),
    enabled: open && detailId.length > 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const { data: workflowResult } = useQuery({
    queryKey: ["workflows", repo ?? "__default__"],
    queryFn: () => fetchWorkflows(repo ?? undefined),
    enabled: open && detailId.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const beat = beatData?.ok ? beatData.data : (initialBeat ?? null);

  const { mutateAsync: handleUpdate } = useMutation({
    mutationFn: async (fields: UpdateBeatInput) =>
      updateBeatOrThrow(beat ? [beat] : [], detailId, fields, repo),
    onMutate: async (fields) => {
      await queryClient.cancelQueries({ queryKey: ["beat", detailId, repo] });
      await queryClient.cancelQueries({ queryKey: ["beats"] });
      const previousBeat = queryClient.getQueryData(["beat", detailId, repo]);
      const previousBeats = queryClient.getQueriesData({ queryKey: ["beats"] });
      queryClient.setQueryData(
        ["beat", detailId, repo],
        (old: unknown) => {
          const prev = old as { ok: boolean; data?: Beat } | undefined;
          if (!prev?.data) return prev;
          return {
            ...prev,
            data: { ...prev.data, ...fields, updated: new Date().toISOString() },
          };
        }
      );
      queryClient.setQueriesData(
        { queryKey: ["beats"] },
        (old: unknown) => {
          const prev = old as { ok: boolean; data?: Beat[] } | undefined;
          if (!prev?.data) return prev;
          return {
            ...prev,
            data: prev.data.map((b) =>
              b.id === detailId
                ? { ...b, ...fields, updated: new Date().toISOString() }
                : b
            ),
          };
        }
      );
      return { previousBeat, previousBeats };
    },
    onError: (error: Error, _fields, context) => {
      toast.error(error.message);
      if (context?.previousBeat) {
        queryClient.setQueryData(["beat", detailId, repo], context.previousBeat);
      }
      if (context?.previousBeats) {
        for (const [key, snapData] of context.previousBeats) {
          queryClient.setQueryData(key, snapData);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["beats"] });
      queryClient.invalidateQueries({ queryKey: ["beat", detailId, repo] });
    },
  });

  const { mutate: handleAddDep } = useMutation({
    mutationFn: ({ source, target }: { source: string; target: string }) =>
      addDep(source, { blocks: target }, repo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beat-deps", detailId, repo] });
      toast.success("Dependency added");
    },
    onError: () => {
      toast.error("Failed to add dependency");
    },
  });

  const beatWorkflow = useMemo((): MemoryWorkflowDescriptor | null => {
    const workflows: MemoryWorkflowDescriptor[] =
      workflowResult?.ok && workflowResult.data ? workflowResult.data : [];
    if (workflows.length === 0 || !beat) return null;
    const profileId = beat.profileId ?? beat.workflowId;
    if (profileId) {
      const match = workflows.find((w) => w.id === profileId);
      if (match) return match;
    }
    return workflows[0] ?? null;
  }, [workflowResult, beat]);

  const deps: BeatDependency[] = depsData?.ok ? (depsData.data ?? []) : [];

  if (!beatId) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setBlocksIds([]);
          setBlockedByIds([]);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[calc(100vh-1rem)] w-[95vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0"
      >
        <LightboxHeader
          beatId={beatId}
          beat={beat}
          isEditingTitle={isEditingTitle}
          editTitleValue={editTitleValue}
          setIsEditingTitle={setIsEditingTitle}
          setEditTitleValue={setEditTitleValue}
          handleUpdate={handleUpdate}
          onShipBeat={onShipBeat}
          isParentRollingBeat={isParentRollingBeat}
          repo={repo}
          onMoved={onMoved}
        />

        <LightboxBody
          beat={beat}
          beatWorkflow={beatWorkflow}
          isLoadingBeat={isLoadingBeat}
          handleUpdate={handleUpdate}
          deps={deps}
          detailId={detailId}
          repo={repo}
          blocksIds={blocksIds}
          blockedByIds={blockedByIds}
          setBlocksIds={setBlocksIds}
          setBlockedByIds={setBlockedByIds}
          handleAddDep={handleAddDep}
        />
      </DialogContent>
    </Dialog>
  );
}

export function getDisplayedBeatId(
  beatId: string,
  beat: Pick<Beat, "id"> | null | undefined,
): string {
  return beat?.id ?? beatId;
}

export function getDisplayedBeatAliases(
  beat: Pick<Beat, "id" | "aliases"> | null | undefined,
): string[] {
  if (!Array.isArray(beat?.aliases)) return [];

  const beatId = beat.id;
  const aliases = new Set<string>();
  for (const alias of beat.aliases) {
    if (typeof alias !== "string") continue;
    const normalized = alias.trim();
    if (!normalized || normalized === beatId) continue;
    aliases.add(normalized);
  }
  return Array.from(aliases);
}

// ── Shared click-to-copy ID chip ──

function ClickToCopyId({ value, suffix }: { value: string; suffix?: string }) {
  return (
    <button
      type="button"
      className="cursor-pointer rounded px-0.5 hover:bg-muted/70"
      title="Click to copy"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => toast.success(`Copied: ${value}`),
          () => toast.error("Failed to copy to clipboard"),
        );
      }}
    >
      {value}
      {suffix && (
        <span className="ml-1 text-muted-foreground">{suffix}</span>
      )}
    </button>
  );
}

// ── Header sub-component ──

interface LightboxHeaderProps {
  beatId: string;
  beat: Beat | null | undefined;
  isEditingTitle: boolean;
  editTitleValue: string;
  setIsEditingTitle: (v: boolean) => void;
  setEditTitleValue: (v: string) => void;
  handleUpdate: (fields: UpdateBeatInput) => Promise<void>;
  onShipBeat?: (beat: Beat) => void;
  isParentRollingBeat?: (beat: Beat) => boolean;
  repo?: string;
  onMoved: (newId: string, targetRepo: string) => void;
}

function LightboxHeader({
  beatId,
  beat,
  isEditingTitle,
  editTitleValue,
  setIsEditingTitle,
  setEditTitleValue,
  handleUpdate,
  onShipBeat,
  isParentRollingBeat,
  repo,
  onMoved,
}: LightboxHeaderProps) {
  const isInheritedRolling = beat ? (isParentRollingBeat?.(beat) ?? false) : false;
  const displayedBeatId = getDisplayedBeatId(beatId, beat);
  const displayedAliases = getDisplayedBeatAliases(beat);

  return (
    <DialogHeader className="border-b border-border/70 px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <DialogDescription className="flex flex-wrap items-center gap-1 break-all font-mono text-[11px]">
            <ClickToCopyId value={displayedBeatId} />
            {displayedAliases.map((alias) => (
              <span key={alias} className="flex items-center gap-1">
                <span className="text-muted-foreground">|</span>
                <ClickToCopyId value={alias} suffix="(alias)" />
              </span>
            ))}
          </DialogDescription>
          {isEditingTitle ? (
            <input
              autoFocus
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onBlur={() => {
                const trimmed = editTitleValue.trim();
                if (trimmed && trimmed !== beat?.title) {
                  void handleUpdate({ title: trimmed });
                }
                setIsEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setIsEditingTitle(false);
                }
              }}
              className="min-w-0 flex-1 truncate rounded border border-border bg-background px-1.5 py-0.5 text-base font-semibold leading-tight outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <DialogTitle
              className="truncate text-base leading-tight cursor-pointer rounded px-0.5 hover:bg-muted/70"
              onClick={() => {
                if (beat) {
                  setEditTitleValue(beat.title);
                  setIsEditingTitle(true);
                }
              }}
            >
              {beat?.title ?? "Loading beat..."}
            </DialogTitle>
          )}
        </div>
        <DialogClose asChild>
          <Button variant="ghost" size="xs">
            Close
          </Button>
        </DialogClose>
      </div>
      {beat && (
        <div className="flex flex-wrap items-center gap-1.5">
          {isInheritedRolling ? (
            <span className="text-xs font-semibold text-green-700 animate-pulse">
              Rolling...
            </span>
          ) : (
            <Button
              variant="outline"
              size="xs"
              title="Take! -- start a session for this beat"
              disabled={!onShipBeat || !canTakeBeat(beat)}
              onClick={() => onShipBeat?.(beat)}
            >
              <Clapperboard className="size-3" />
              Take!
            </Button>
          )}
          <MoveToProjectDialog
            beat={beat}
            currentRepo={repo}
            onMoved={onMoved}
          />
        </div>
      )}
    </DialogHeader>
  );
}

// ── Body sub-component ──

// ── Handoff Capsules (collapsible, reverse-chronological) ──

function formatCapsuleDate(dateStr: unknown): string {
  if (typeof dateStr !== "string") return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HandoffCapsules({ beat }: { beat: Beat }) {
  const capsules = beat.metadata?.knotsHandoffCapsules;
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!Array.isArray(capsules) || capsules.length === 0) return null;

  // Reverse so latest is first
  const reversed = [...capsules].reverse() as Array<Record<string, unknown>>;

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        onClick={() => setSectionOpen((v) => !v)}
      >
        {sectionOpen ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        Handoff Capsules ({reversed.length})
      </button>

      {sectionOpen && (
        <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-0.5">
          {reversed.map((cap, i) => {
            const content =
              typeof cap.content === "string"
                ? cap.content
                : typeof cap.summary === "string"
                  ? cap.summary
                  : typeof cap.message === "string"
                    ? cap.message
                    : null;
            const agent =
              typeof cap.agentname === "string" ? cap.agentname : null;
            const model =
              typeof cap.model === "string" ? cap.model : null;
            const version =
              typeof cap.version === "string" ? cap.version : null;
            const date = formatCapsuleDate(cap.datetime);
            const isExpanded = expandedIdx === i;

            const agentLabel = [agent, model, version]
              .filter(Boolean)
              .join(" · ");

            return (
              <div
                key={i}
                className="rounded-md border border-border/70 bg-background/50 text-xs"
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-1 px-2 py-1.5 text-left hover:bg-muted/40"
                  onClick={() => setExpandedIdx(isExpanded ? null : i)}
                >
                  {isExpanded ? (
                    <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {date && <span className="mr-1 font-medium text-foreground">{date}</span>}
                    {agentLabel || (content ? content.slice(0, 60) : "capsule")}
                  </span>
                </button>

                {isExpanded && content && (
                  <div className="border-t border-border/50 px-2 py-1.5">
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground">
                      {content}
                    </p>
                    {agentLabel && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {agentLabel}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface LightboxBodyProps {
  beat: Beat | null | undefined;
  beatWorkflow: MemoryWorkflowDescriptor | null;
  isLoadingBeat: boolean;
  handleUpdate: (fields: UpdateBeatInput) => Promise<void>;
  deps: BeatDependency[];
  detailId: string;
  repo?: string;
  blocksIds: string[];
  blockedByIds: string[];
  setBlocksIds: React.Dispatch<React.SetStateAction<string[]>>;
  setBlockedByIds: React.Dispatch<React.SetStateAction<string[]>>;
  handleAddDep: (args: { source: string; target: string }) => void;
}

function LightboxBody({
  beat,
  beatWorkflow,
  isLoadingBeat,
  handleUpdate,
  deps,
  detailId,
  repo,
  blocksIds,
  blockedByIds,
  setBlocksIds,
  setBlockedByIds,
  handleAddDep,
}: LightboxBodyProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)] lg:grid-rows-1">
      <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-3 py-2">
        {isLoadingBeat && !beat ? (
          <div className="py-6 text-sm text-muted-foreground">Loading beat...</div>
        ) : beat ? (
          <BeatDetail
            beat={beat}
            workflow={beatWorkflow}
            onUpdate={async (fields) => {
              await handleUpdate(fields);
            }}
          />
        ) : (
          <div className="py-6 text-sm text-muted-foreground">Beat not found.</div>
        )}
      </div>

      <aside className="min-h-0 min-w-0 space-y-3 overflow-y-auto overflow-x-hidden border-t border-border/70 bg-muted/20 px-3 py-2 lg:border-t-0 lg:border-l">
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Dependencies
          </h3>
          <DepTree deps={deps} beatId={detailId} repo={repo} />
        </section>

        {beat && <HandoffCapsules beat={beat} />}

        {beat && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Add Relationship
            </h3>
            <RelationshipPicker
              label="This beat blocks"
              selectedIds={blocksIds}
              onAdd={(id) => {
                handleAddDep({ source: detailId, target: id });
                setBlocksIds((prev) => [...prev, id]);
              }}
              onRemove={(id) => {
                setBlocksIds((prev) => prev.filter((x) => x !== id));
              }}
              excludeId={detailId}
              repo={repo}
            />
            <RelationshipPicker
              label="This beat is blocked by"
              selectedIds={blockedByIds}
              onAdd={(id) => {
                handleAddDep({ source: id, target: detailId });
                setBlockedByIds((prev) => [...prev, id]);
              }}
              onRemove={(id) => {
                setBlockedByIds((prev) => prev.filter((x) => x !== id));
              }}
              excludeId={detailId}
              repo={repo}
            />
          </section>
        )}
      </aside>
    </div>
  );
}
