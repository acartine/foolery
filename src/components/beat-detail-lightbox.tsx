"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Zap } from "lucide-react";
import { toast } from "sonner";
import type { Beat, BeatDependency, MemoryWorkflowDescriptor } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { fetchBead, fetchDeps, fetchWorkflows, updateBead, addDep } from "@/lib/api";
import { buildBeadBreakdownPrompt, setDirectPrefillPayload } from "@/lib/breakdown-prompt";
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
}

export function BeatDetailLightbox({
  open,
  beatId,
  repo,
  initialBeat,
  onOpenChange,
  onMoved,
  onShipBeat,
}: BeatDetailLightboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [blocksIds, setBlocksIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const queryClient = useQueryClient();

  const detailId = beatId ?? "";

  const { data: beatData, isLoading: isLoadingBeat } = useQuery({
    queryKey: ["bead", detailId, repo],
    queryFn: () => fetchBead(detailId, repo),
    enabled: open && detailId.length > 0,
    placeholderData: initialBeat ? { ok: true, data: initialBeat } : undefined,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const { data: depsData } = useQuery({
    queryKey: ["bead-deps", detailId, repo],
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

  const { mutateAsync: handleUpdate } = useMutation({
    mutationFn: async (fields: UpdateBeatInput) => {
      const result = await updateBead(detailId, fields, repo);
      if (!result.ok) throw new Error(result.error ?? "Failed to update beat");
    },
    onMutate: async (fields) => {
      await queryClient.cancelQueries({ queryKey: ["bead", detailId, repo] });
      await queryClient.cancelQueries({ queryKey: ["beads"] });
      const previousBeat = queryClient.getQueryData(["bead", detailId, repo]);
      const previousBeats = queryClient.getQueriesData({ queryKey: ["beads"] });
      queryClient.setQueryData(
        ["bead", detailId, repo],
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
        { queryKey: ["beads"] },
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
        queryClient.setQueryData(["bead", detailId, repo], context.previousBeat);
      }
      if (context?.previousBeats) {
        for (const [key, snapData] of context.previousBeats) {
          queryClient.setQueryData(key, snapData);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      queryClient.invalidateQueries({ queryKey: ["bead", detailId, repo] });
    },
  });

  const { mutate: handleAddDep } = useMutation({
    mutationFn: ({ source, target }: { source: string; target: string }) =>
      addDep(source, { blocks: target }, repo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bead-deps", detailId, repo] });
      toast.success("Dependency added");
    },
    onError: () => {
      toast.error("Failed to add dependency");
    },
  });

  const beat = beatData?.ok ? beatData.data : (initialBeat ?? null);

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

  const handleBreakdown = useCallback(() => {
    if (!beatId) return;

    setDirectPrefillPayload({
      prompt: buildBeadBreakdownPrompt(beatId, beat?.title ?? ""),
      autorun: true,
      sourceBeatId: beatId,
    });

    onOpenChange(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "orchestration");
    params.delete("bead");
    params.delete("detailRepo");
    params.delete("parent");
    router.push(`/beads?${params.toString()}`);
  }, [beatId, beat, onOpenChange, searchParams, router]);

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
        className="flex h-[92vh] max-h-[calc(100vh-1rem)] w-[96vw] max-w-[min(1120px,96vw)] flex-col gap-0 overflow-hidden p-0"
      >
        <LightboxHeader
          beatId={beatId}
          beat={beat}
          isEditingTitle={isEditingTitle}
          editTitleValue={editTitleValue}
          setIsEditingTitle={setIsEditingTitle}
          setEditTitleValue={setEditTitleValue}
          handleUpdate={handleUpdate}
          handleBreakdown={handleBreakdown}
          onShipBeat={onShipBeat}
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

// ── Header sub-component ──

interface LightboxHeaderProps {
  beatId: string;
  beat: Beat | null | undefined;
  isEditingTitle: boolean;
  editTitleValue: string;
  setIsEditingTitle: (v: boolean) => void;
  setEditTitleValue: (v: string) => void;
  handleUpdate: (fields: UpdateBeatInput) => Promise<void>;
  handleBreakdown: () => void;
  onShipBeat?: (beat: Beat) => void;
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
  handleBreakdown,
  onShipBeat,
  repo,
  onMoved,
}: LightboxHeaderProps) {
  return (
    <DialogHeader className="border-b border-border/70 px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <DialogDescription
            className="shrink-0 cursor-pointer font-mono text-[11px]"
            onClick={() => {
              const shortId = beatId.replace(/^[^-]+-/, "");
              navigator.clipboard.writeText(shortId);
            }}
            title="Click to copy ID"
          >
            {beatId.replace(/^[^-]+-/, "")}
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
          <Button
            variant="outline"
            size="xs"
            title="Take! -- start a session for this beat"
            disabled={beat.state !== "open" || !onShipBeat || beat.isAgentClaimable === false}
            onClick={() => onShipBeat?.(beat)}
          >
            <Clapperboard className="size-3" />
            Take!
          </Button>
          <Button
            variant="outline"
            size="xs"
            title="Break this beat down into hierarchical tasks via Direct"
            onClick={handleBreakdown}
          >
            <Zap className="size-3" />
            Breakdown
          </Button>
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
