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
import type { UpdateBeadInput } from "@/lib/schemas";
import { rejectBeadFields } from "@/components/bead-columns";

interface NotesDialogProps {
  bead: Bead | null;
  open: boolean;
  /** When true, the dialog opens in rejection mode with only Reject + Cancel buttons. */
  rejectionMode?: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, fields: UpdateBeadInput) => void;
}

const REJECTION_PREFIX = "Rejection Reason: ";

export function NotesDialog({ bead, open, rejectionMode, onOpenChange, onUpdate }: NotesDialogProps) {
  const [notes, setNotes] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (bead && open) {
      if (rejectionMode) {
        const existing = bead.notes ?? "";
        const value = existing ? `${existing}\n${REJECTION_PREFIX}` : REJECTION_PREFIX;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Initializing controlled textarea value when dialog opens; mirrors prior pattern.
        setNotes(value);
      } else {
        setNotes(bead.notes ?? "");
      }
    }
  }, [bead, open, rejectionMode]);

  // Position cursor after "Rejection Reason: " when in rejection mode
  useEffect(() => {
    if (open && rejectionMode && textareaRef.current) {
      const el = textareaRef.current;
      requestAnimationFrame(() => {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    }
  }, [open, rejectionMode]);

  if (!bead) return null;

  const hasVerification = bead.labels?.includes("stage:verification");

  const handleSave = () => {
    onUpdate(bead.id, { notes });
    onOpenChange(false);
  };

  const handleReject = () => {
    onUpdate(bead.id, { ...rejectBeadFields(bead), notes });
    onOpenChange(false);
  };

  if (rejectionMode) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject Work</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {bead.id} — {bead.title}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            ref={textareaRef}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add rejection reason..."
            className="min-h-[200px]"
          />
          <DialogFooter>
            <Button variant="outline" title="Cancel without rejecting" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" title="Reject this work and return to open" onClick={handleReject}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
