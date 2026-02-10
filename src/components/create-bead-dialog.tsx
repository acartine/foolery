"use client";

import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BeadForm } from "@/components/bead-form";
import { createBead } from "@/lib/api";
import type { CreateBeadInput } from "@/lib/schemas";

interface CreateBeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateBeadDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateBeadDialogProps) {
  async function handleSubmit(data: CreateBeadInput) {
    const result = await createBead(data);
    if (result.ok) {
      toast.success("Bead created");
      onCreated();
    } else {
      toast.error(result.error ?? "Failed to create bead");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Bead</DialogTitle>
          <DialogDescription>
            Add a new issue or task to your project.
          </DialogDescription>
        </DialogHeader>
        <BeadForm mode="create" onSubmit={handleSubmit} />
      </DialogContent>
    </Dialog>
  );
}
