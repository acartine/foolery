"use client";

import { useState, useEffect } from "react";
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
import type { UpdateBeadInput } from "@/lib/schemas";
import { rejectBeadFields } from "@/components/bead-columns";

interface NotesDialogProps {
  bead: Bead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, fields: UpdateBeadInput) => void;
}

export function NotesDialog({ bead, open, onOpenChange, onUpdate }: NotesDialogProps) {
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (bead && open) {
      setNotes(bead.notes ?? "");
    }
  }, [bead, open]);

  if (!bead) return null;

  const hasVerification = bead.labels?.includes("stage:verification");

  const handleSave = () => {
    onUpdate(bead.id, { notes });
    onOpenChange(false);
  };

  const handleReject = () => {
    onUpdate(bead.id, rejectBeadFields(bead));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {bead.id} — {bead.title}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes..."
          className="min-h-[200px]"
          autoFocus
        />
        <DialogFooter>
          {hasVerification && (
            <Button variant="destructive" title="Reject this work and return to open" onClick={handleReject} className="mr-auto">
              Reject Work?
            </Button>
          )}
          <Button variant="outline" title="Close without saving" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} title="Save notes">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
