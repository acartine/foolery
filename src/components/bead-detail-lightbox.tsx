"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import type { Bead } from "@/lib/types";
import type { UpdateBeadInput } from "@/lib/schemas";
import { fetchBead, fetchDeps, updateBead, addDep } from "@/lib/api";
import {
  buildBeadBreakdownPrompt,
  setDirectPrefillPayload,
} from "@/lib/breakdown-prompt";
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
}

export function BeadDetailLightbox({
  open,
  beadId,
  repo,
  initialBead,
  onOpenChange,
  onMoved,
}: BeadDetailLightboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [blocksIds, setBlocksIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const detailId = beadId ?? "";

  const { data: beadData, isLoading: isLoadingBead } = useQuery({
    queryKey: ["bead", detailId, repo],
    queryFn: () => fetchBead(detailId, repo),
    enabled: open && detailId.length > 0,
    placeholderData: initialBead ? { ok: true, data: initialBead } : undefined,
  });

  const { data: depsData } = useQuery({
    queryKey: ["bead-deps", detailId, repo],
    queryFn: () => fetchDeps(detailId, repo),
    enabled: open && detailId.length > 0,
  });

  const { mutateAsync: handleUpdate } = useMutation({
    mutationFn: async (fields: UpdateBeadInput) => {
      const result = await updateBead(detailId, fields, repo);
      if (!result.ok) throw new Error(result.error ?? "Failed to update beat");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beads"] });
      queryClient.invalidateQueries({ queryKey: ["bead", detailId, repo] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
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

  const handleBreakdown = useCallback(() => {
    if (!beadId) return;
    const title = (beadData?.ok ? beadData.data?.title : initialBead?.title) ?? beadId;
    const prompt = buildBeadBreakdownPrompt(beadId, title);

    setDirectPrefillPayload({ prompt, autorun: true, sourceBeadId: beadId });
    console.info("[breakdown] Breakdown invoked", { beadId, prompt: prompt.slice(0, 80) });

    // Close the lightbox, then navigate to Direct view
    onOpenChange(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "orchestration");
    params.delete("bead");
    params.delete("detailRepo");
    router.push(`/beads?${params.toString()}`);
  }, [beadId, beadData, initialBead, onOpenChange, searchParams, router]);

  const bead = beadData?.ok ? beadData.data : (initialBead ?? null);
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
        <DialogHeader className="border-b border-border/70 px-3 py-2">
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
              <DialogTitle className="truncate text-base leading-tight">
                {bead?.title ?? "Loading beat..."}
              </DialogTitle>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {bead && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  title="Break this beat down into hierarchical tasks via Direct"
                  onClick={handleBreakdown}
                >
                  <Zap className="size-3" />
                  Breakdown
                </Button>
              )}
              {bead && (
                <MoveToProjectDialog
                  bead={bead}
                  currentRepo={repo}
                  onMoved={onMoved}
                />
              )}
              <DialogClose asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  Close
                </Button>
              </DialogClose>
            </div>
          </div>
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
