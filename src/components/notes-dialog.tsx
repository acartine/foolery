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
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";

interface NotesDialogProps {
  beat: Beat | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, fields: UpdateBeatInput) => void;
}

export function NotesDialog({ beat, open, onOpenChange, onUpdate }: NotesDialogProps) {
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (beat && open) {
      // Initializing controlled textarea value when dialog
      // opens; mirrors prior pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotes(beat.notes ?? "");
    }
  }, [beat, open]);

  if (!beat) return null;

  const handleSave = () => {
    onUpdate(beat.id, { notes });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {beat.id} — {beat.title}
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
          <Button variant="outline" title="Close without saving" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} title="Save notes">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
