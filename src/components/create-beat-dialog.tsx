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
import { fetchSettings } from "@/lib/settings-api";
import type { CreateBeatInput } from "@/lib/schemas";
import { buildBeadFocusHref, stripBeadPrefix } from "@/lib/bead-navigation";
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
  const { data: settingsResult } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    enabled: open,
  });
  const workflows: MemoryWorkflowDescriptor[] =
    workflowResult?.ok && workflowResult.data ? workflowResult.data : [];
  const settingsProfileId = settingsResult?.ok
    ? settingsResult.data?.defaults?.profileId
    : undefined;
  const defaultProfileId =
    (settingsProfileId
      ? workflows.find(
          (w) => (w.profileId ?? w.id) === settingsProfileId,
        )?.id
      : undefined) ??
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
        const shortId = createdId ? stripBeadPrefix(createdId) : "";
        toast.success(createdId ? `Created bead ${createdId}` : `Created ${shortId}`, {
          action: createdId
            ? {
                label: shortId || createdId,
                onClick: () => {
                  router.push(
                    buildBeadFocusHref(createdId, searchParams.toString(), {
                      detailRepo: repo,
                    }),
                  );
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
        const shortId2 = createdId2 ? stripBeadPrefix(createdId2) : "";
        toast.success(
          createdId2
            ? `Created bead ${createdId2} — ready for another`
            : `Created ${shortId2} — ready for another`,
          {
          action: createdId2
            ? {
                label: shortId2 || createdId2,
                onClick: () => {
                  router.push(
                    buildBeadFocusHref(createdId2, searchParams.toString(), {
                      detailRepo: repo,
                    }),
                  );
                },
              }
            : undefined,
          },
        );
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
      const createdId = result.data.id;
      const shortId = stripBeadPrefix(createdId);
      toast.success(`Created bead ${createdId} — starting breakdown...`, {
        action: {
          label: shortId || createdId,
          onClick: () => {
            router.push(
              buildBeadFocusHref(createdId, searchParams.toString(), {
                detailRepo: repo,
              }),
            );
          },
        },
      });
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["beads"] });

      const params = new URLSearchParams(searchParams.toString());
      params.set("view", "breakdown");
      params.set("parent", result.data.id);
      params.delete("bead");
      params.delete("detailRepo");
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
