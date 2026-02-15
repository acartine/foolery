"use client";

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BeadForm } from "@/components/bead-form";
import type { RelationshipDeps } from "@/components/bead-form";
import { createBead, addDep } from "@/lib/api";
import type { CreateBeadInput } from "@/lib/schemas";

async function addDepsForBead(
  beadId: string,
  deps: RelationshipDeps,
  repo?: string,
) {
  const promises: Promise<unknown>[] = [];
  for (const blockId of deps.blocks) {
    promises.push(addDep(beadId, { blocks: blockId }, repo));
  }
  for (const blockerId of deps.blockedBy) {
    promises.push(addDep(blockerId, { blocks: beadId }, repo));
  }
  await Promise.allSettled(promises);
}

interface CreateBeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  repo?: string | null;
}

export function CreateBeadDialog({
  open,
  onOpenChange,
  onCreated,
  repo,
}: CreateBeadDialogProps) {
  const [formKey, setFormKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const queryClient = useQueryClient();

  async function handleSubmit(
    data: CreateBeadInput,
    deps?: RelationshipDeps,
  ) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await createBead(data, repo ?? undefined);
      if (result.ok) {
        if (deps && result.data?.id) {
          await addDepsForBead(result.data.id, deps, repo ?? undefined);
        }
        toast.success("Created");
        onCreated();
      } else {
        toast.error(result.error ?? "Failed to create");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleCreateMore(
    data: CreateBeadInput,
    deps?: RelationshipDeps,
  ) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await createBead(data, repo ?? undefined);
      if (result.ok) {
        if (deps && result.data?.id) {
          await addDepsForBead(result.data.id, deps, repo ?? undefined);
        }
        toast.success("Created — ready for another");
        setFormKey((k) => k + 1);
        queryClient.invalidateQueries({ queryKey: ["beads"] });
      } else {
        toast.error(result.error ?? "Failed to create");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New</DialogTitle>
          <DialogDescription>
            Add a new issue or task to your project.
          </DialogDescription>
        </DialogHeader>
        <BeadForm
          key={formKey}
          mode="create"
          onSubmit={handleSubmit}
          onCreateMore={handleCreateMore}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}
