"use client";

import { useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BeatForm } from "@/components/beat-form";
import type { RelationshipDeps } from "@/components/beat-form";
import { createBead, addDep, fetchWorkflows } from "@/lib/api";
import type { CreateBeatInput } from "@/lib/schemas";
import { buildBeadBreakdownPrompt, setDirectPrefillPayload } from "@/lib/breakdown-prompt";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

async function addDepsForBeat(
  beatId: string,
  deps: RelationshipDeps,
  repo?: string,
) {
  const promises: Promise<unknown>[] = [];
  for (const blockId of deps.blocks) {
    promises.push(addDep(beatId, { blocks: blockId }, repo));
  }
  for (const blockerId of deps.blockedBy) {
    promises.push(addDep(blockerId, { blocks: beatId }, repo));
  }
  await Promise.allSettled(promises);
}

interface CreateBeatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  repo?: string | null;
}

export function CreateBeatDialog({
  open,
  onOpenChange,
  onCreated,
  repo,
}: CreateBeatDialogProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formKey, setFormKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const queryClient = useQueryClient();
  const { data: workflowResult } = useQuery({
    queryKey: ["workflows", repo ?? "__default__"],
    queryFn: () => fetchWorkflows(repo ?? undefined),
    enabled: open,
  });
  const workflows: MemoryWorkflowDescriptor[] =
    workflowResult?.ok && workflowResult.data ? workflowResult.data : [];
  const defaultProfileId =
    workflows.find((workflow) => workflow.id === "autopilot")?.id ??
    workflows[0]?.id;
  const isKnotsBackend = workflows.some((w) => w.label?.startsWith("Knots"));

  function withSelectedProfile(input: CreateBeatInput): CreateBeatInput {
    const selected = input.profileId ?? input.workflowId ?? defaultProfileId;
    if (!selected) return input;
    return {
      ...input,
      profileId: selected,
      workflowId: undefined,
    };
  }

  async function handleSubmit(
    data: CreateBeatInput,
    deps?: RelationshipDeps,
  ) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const payload = withSelectedProfile(data);

      const result = await createBead(payload, repo ?? undefined);
      if (result.ok) {
        if (deps && result.data?.id) {
          await addDepsForBeat(result.data.id, deps, repo ?? undefined);
        }
        const createdId = result.data?.id;
        const shortId = createdId?.replace(/^[^-]+-/, "") ?? "";
        toast.success(`Created ${shortId}`, {
          action: createdId
            ? {
                label: "Open",
                onClick: () => {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("bead", createdId);
                  if (repo) params.set("detailRepo", repo);
                  router.push(`/beads?${params.toString()}`);
                },
              }
            : undefined,
        });
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
    data: CreateBeatInput,
    deps?: RelationshipDeps,
  ) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const payload = withSelectedProfile(data);

      const result = await createBead(payload, repo ?? undefined);
      if (result.ok) {
        if (deps && result.data?.id) {
          await addDepsForBeat(result.data.id, deps, repo ?? undefined);
        }
        const createdId2 = result.data?.id;
        const shortId2 = createdId2?.replace(/^[^-]+-/, "") ?? "";
        toast.success(`Created ${shortId2} — ready for another`, {
          action: createdId2
            ? {
                label: "Open",
                onClick: () => {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("bead", createdId2);
                  if (repo) params.set("detailRepo", repo);
                  router.push(`/beads?${params.toString()}`);
                },
              }
            : undefined,
        });
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

  async function handleBreakdown(data: CreateBeatInput) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const payload = withSelectedProfile(data);

      const result = await createBead(payload, repo ?? undefined);
      if (!result.ok || !result.data?.id) {
        toast.error(result.error ?? "Failed to create parent beat");
        return;
      }
      const shortId3 = result.data.id.replace(/^[^-]+-/, "");
      toast.success(`Created ${shortId3} — starting breakdown...`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["beads"] });

      setDirectPrefillPayload({
        prompt: buildBeadBreakdownPrompt(result.data.id, data.title),
        autorun: true,
        sourceBeatId: result.data.id,
      });

      const params = new URLSearchParams(searchParams.toString());
      params.set("view", "orchestration");
      router.push(`/beads?${params.toString()}`);
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
        <BeatForm
          key={formKey}
          mode="create"
          workflows={workflows}
          hideTypeSelector={isKnotsBackend}
          defaultValues={{
            profileId: defaultProfileId,
            workflowId: undefined,
          }}
          onSubmit={handleSubmit}
          onCreateMore={handleCreateMore}
          onBreakdown={handleBreakdown}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}
