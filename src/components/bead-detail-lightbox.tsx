"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Zap } from "lucide-react";
import { toast } from "sonner";
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { fetchBead, fetchDeps, updateBead, addDep } from "@/lib/api";
import { buildBeadBreakdownPrompt, setDirectPrefillPayload } from "@/lib/breakdown-prompt";
import { BeadDetail } from "@/components/bead-detail";
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

interface BeadDetailLightboxProps {
  open: boolean;
  beadId: string | null;
  repo?: string;
  initialBead?: Bead | null;
  onOpenChange: (open: boolean) => void;
  onMoved: (newId: string, targetRepo: string) => void;
  onShipBead?: (bead: Bead) => void;
}

export function BeadDetailLightbox({
  open,
  beadId,
  repo,
  initialBead,
  onOpenChange,
  onMoved,
  onShipBead,
}: BeadDetailLightboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [blocksIds, setBlocksIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const queryClient = useQueryClient();

  const detailId = beadId ?? "";

  const { data: beadData, isLoading: isLoadingBead } = useQuery({
    queryKey: ["bead", detailId, repo],
    queryFn: () => fetchBead(detailId, repo),
    enabled: open && detailId.length > 0,
    placeholderData: initialBead ? { ok: true, data: initialBead } : undefined,
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

  const { mutateAsync: handleUpdate } = useMutation({
    mutationFn: async (fields: UpdateBeadInput) => {
      const result = await updateBead(detailId, fields, repo);
      if (!result.ok) throw new Error(result.error ?? "Failed to update beat");
    },
    onMutate: async (fields) => {
      // Cancel outgoing refetches so they don't overwrite optimistic data
      await queryClient.cancelQueries({ queryKey: ["bead", detailId, repo] });
      await queryClient.cancelQueries({ queryKey: ["beads"] });

      // Snapshot current caches for rollback
      const previousBead = queryClient.getQueryData(["bead", detailId, repo]);
      const previousBeads = queryClient.getQueriesData({ queryKey: ["beads"] });

      // Optimistically update the individual bead query
      queryClient.setQueryData(
        ["bead", detailId, repo],
        (old: unknown) => {
          const prev = old as { ok: boolean; data?: Bead } | undefined;
          if (!prev?.data) return prev;
          return {
            ...prev,
            data: { ...prev.data, ...fields, updated: new Date().toISOString() },
          };
        }
      );

      // Optimistically update the beads list queries
      queryClient.setQueriesData(
        { queryKey: ["beads"] },
        (old: unknown) => {
          const prev = old as { ok: boolean; data?: Bead[] } | undefined;
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

      return { previousBead, previousBeads };
    },
    onError: (error: Error, _fields, context) => {
      toast.error(error.message);
      // Roll back optimistic updates
      if (context?.previousBead) {
        queryClient.setQueryData(["bead", detailId, repo], context.previousBead);
      }
      if (context?.previousBeads) {
        for (const [key, snapData] of context.previousBeads) {
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

  const bead = beadData?.ok ? beadData.data : (initialBead ?? null);

  const handleBreakdown = useCallback(() => {
    if (!beadId) return;

    setDirectPrefillPayload({
      prompt: buildBeadBreakdownPrompt(beadId, bead?.title ?? ""),
      autorun: true,
      sourceBeadId: beadId,
    });

    onOpenChange(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "orchestration");
    params.delete("bead");
    params.delete("detailRepo");
    params.delete("parent");
    router.push(`/beads?${params.toString()}`);
  }, [beadId, bead, onOpenChange, searchParams, router]);

  const deps = depsData?.ok ? (depsData.data ?? []) : [];

  if (!beadId) return null;

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
        <DialogHeader className="border-b border-border/70 px-3 py-2 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <DialogDescription
                className="shrink-0 cursor-pointer font-mono text-[11px]"
                onClick={() => {
                  const shortId = beadId.replace(/^[^-]+-/, "");
                  navigator.clipboard.writeText(shortId);
                }}
                title="Click to copy ID"
              >
                {beadId.replace(/^[^-]+-/, "")}
              </DialogDescription>
              {isEditingTitle ? (
                <input
                  autoFocus
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={() => {
                    if (editTitleValue.trim() && editTitleValue !== bead?.title) {
                      handleUpdate({ title: editTitleValue.trim() });
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
                    if (bead) {
                      setEditTitleValue(bead.title);
                      setIsEditingTitle(true);
                    }
                  }}
                >
                  {bead?.title ?? "Loading beat..."}
                </DialogTitle>
              )}
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="xs">
                Close
              </Button>
            </DialogClose>
          </div>
          {bead && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                title="Take! — start a session for this beat"
                disabled={bead.status !== "open" || !onShipBead}
                onClick={() => onShipBead?.(bead)}
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
                bead={bead}
                currentRepo={repo}
                onMoved={onMoved}
              />
            </div>
          )}
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)] lg:grid-rows-1">
          <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-3 py-2">
            {isLoadingBead && !bead ? (
              <div className="py-6 text-sm text-muted-foreground">Loading beat...</div>
            ) : bead ? (
              <BeadDetail
                bead={bead}
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
              <DepTree deps={deps} beadId={detailId} repo={repo} />
            </section>

            {bead && (
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
      </DialogContent>
    </Dialog>
  );
}
