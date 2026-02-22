"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CascadeDescendant } from "@/lib/cascade-close";

interface CascadeCloseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentTitle: string;
  descendants: CascadeDescendant[];
  loading: boolean;
  onConfirm: () => void;
}

export function CascadeCloseDialog({
  open,
  onOpenChange,
  parentTitle,
  descendants,
  loading,
  onConfirm,
}: CascadeCloseDialogProps) {
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = () => {
    setConfirming(true);
    onConfirm();
  };

  // Reset confirming state when dialog closes
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setConfirming(false);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close Parent and Children?</DialogTitle>
          <DialogDescription>
            Closing <span className="font-semibold">{parentTitle}</span> will
            also close {descendants.length}{" "}
            {descendants.length === 1 ? "child bead" : "child beads"}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
            Loading children...
          </div>
        ) : (
          <DescendantList descendants={descendants} />
        )}

        <DialogFooter>
          <Button
            variant="outline"
            title="Cancel without closing"
            onClick={() => handleOpenChange(false)}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            title="Close parent and all children"
            onClick={handleConfirm}
            disabled={loading || confirming || descendants.length === 0}
          >
            {confirming ? "Closing..." : `Close All (${descendants.length + 1})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DescendantList({ descendants }: { descendants: CascadeDescendant[] }) {
  if (descendants.length === 0) return null;

  return (
    <div className="max-h-48 overflow-y-auto rounded border p-2">
      <ul className="space-y-1">
        {descendants.map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">
              {d.id.replace(/^[^-]+-/, "")}
            </span>
            <span className="truncate">{d.title}</span>
            <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {d.status.replace("_", " ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
