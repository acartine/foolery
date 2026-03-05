"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Merge } from "lucide-react";
import { toast } from "sonner";
import { mergeBeats } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Beat } from "@/lib/types";

interface MergeBeatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beats: Beat[];
  onMerged: () => void;
}

export function MergeBeatsDialog({
  open,
  onOpenChange,
  beats,
  onMerged,
}: MergeBeatsDialogProps) {
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const survivor = beats.find((b) => b.id === survivorId);
  const consumed = beats.find((b) => b.id !== survivorId);

  const { mutate: handleMerge, isPending } = useMutation({
    mutationFn: async () => {
      if (!survivor || !consumed) throw new Error("Select a survivor");
      const repo = (survivor as unknown as Record<string, unknown>)._repoPath as
        | string
        | undefined;
      const result = await mergeBeats(survivor.id, consumed.id, repo);
      if (!result.ok) {
        throw new Error(result.error ?? "Merge failed");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["beats"] });
      toast.success("Beats merged");
      onOpenChange(false);
      setSurvivorId(null);
      onMerged();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) setSurvivorId(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge Beats</DialogTitle>
          <DialogDescription>
            Pick the survivor. The other beat&apos;s labels, description, and
            notes will be appended to it, then the other beat will be closed.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-2">
          <p className="text-sm font-medium mb-1">Select the survivor:</p>
          {beats.map((beat) => (
            <button
              key={beat.id}
              type="button"
              onClick={() => setSurvivorId(beat.id)}
              className={cn(
                "w-full text-left rounded-md border p-3 transition-colors",
                survivorId === beat.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {beat.id}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium px-1.5 py-0.5 rounded",
                    survivorId === beat.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {survivorId === beat.id ? "SURVIVOR" : "CONSUMED"}
                </span>
              </div>
              <div className="mt-1 text-sm font-medium truncate">
                {beat.title}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {beat.type} &middot; P{beat.priority} &middot; {beat.state}
                {beat.labels.length > 0 && (
                  <> &middot; {beat.labels.join(", ")}</>
                )}
              </div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button
            title="Cancel merge"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            title="Merge selected beats"
            onClick={() => handleMerge()}
            disabled={!survivorId || isPending}
          >
            {isPending ? (
              "Merging..."
            ) : (
              <>
                <Merge className="mr-2 h-4 w-4" />
                Merge
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
