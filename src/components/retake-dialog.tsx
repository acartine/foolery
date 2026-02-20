"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Bead } from "@/lib/types";

interface RetakeDialogProps {
  bead: Bead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (notes: string) => void;
  isPending?: boolean;
}

/** Extract the commit sha from a bead's labels (commit:<sha>). */
function extractCommitSha(bead: Bead): string | undefined {
  const label = bead.labels?.find((l) => l.startsWith("commit:"));
  return label ? label.slice("commit:".length) : undefined;
}

export function RetakeDialog({ bead, open, onOpenChange, onConfirm, isPending }: RetakeDialogProps) {
  const [notes, setNotes] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Resetting controlled textarea value when dialog opens; mirrors notes-dialog pattern.
    if (open) setNotes("");
  }, [open]);

  useEffect(() => {
    if (open && textareaRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  if (!bead) return null;

  const commitSha = extractCommitSha(bead);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ReTake</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {bead.id} — {bead.title}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This will reopen the bead as <span className="font-semibold text-foreground">in_progress</span> for
            regression investigation.
            {commitSha && (
              <>
                {" "}The original achievement was at commit{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{commitSha}</code>.
              </>
            )}
          </p>
          <Textarea
            ref={textareaRef}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional: describe what regressed..."
            className="min-h-[100px]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" title="Cancel" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            className="bg-amber-600 text-white hover:bg-amber-700"
            title="Reopen bead for regression investigation"
            onClick={() => onConfirm(notes)}
            disabled={isPending}
          >
            {isPending ? "Reopening..." : "ReTake"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
