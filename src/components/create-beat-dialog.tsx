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
import { createBeat, addDep, fetchWorkflows } from "@/lib/api";
import { fetchSettings } from "@/lib/settings-api";
import type { CreateBeatInput } from "@/lib/schemas";
import { buildBeatFocusHref, stripBeatPrefix } from "@/lib/beat-navigation";
import { profileDisplayName } from "@/lib/workflows";
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import { clearDraft } from "@/lib/create-draft-persistence";

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

function resolveDefaultProfileId(
  workflows: MemoryWorkflowDescriptor[],
  settingsProfileId: string | undefined,
): string | undefined {
  const normalized = settingsProfileId
    ? profileDisplayName(settingsProfileId).trim().toLowerCase()
    : undefined;
  return (
    (normalized
      ? workflows.find(
          (w) =>
            profileDisplayName(w.profileId ?? w.id)
              .trim()
              .toLowerCase() === normalized,
        )?.id
      : undefined) ??
    workflows.find((w) => w.id === "autopilot")?.id ??
    workflows[0]?.id
  );
}

function buildToastAction(
  beatId: string | undefined,
  navigateToBeat: (id: string) => void,
) {
  if (!beatId) return undefined;
  const shortId = stripBeatPrefix(beatId);
  return {
    label: shortId || beatId,
    onClick: () => navigateToBeat(beatId),
  };
}

function useCreateBeatQueries(
  open: boolean,
  repo: string | null | undefined,
) {
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
    workflowResult?.ok && workflowResult.data
      ? workflowResult.data
      : [];
  const settingsProfileId = settingsResult?.ok
    ? settingsResult.data?.defaults?.profileId
    : undefined;
  const defaultProfileId = resolveDefaultProfileId(
    workflows,
    settingsProfileId,
  );
  const isKnotsBackend = workflows.some(
    (w) => w.id === "autopilot" || w.id === "semiauto",
  );
  return { workflows, defaultProfileId, isKnotsBackend };
}

function useSubmitBeat(
  repo: string | null | undefined,
  defaultProfileId: string | undefined,
) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submitBeat(
    data: CreateBeatInput,
    deps: RelationshipDeps | undefined,
    onSuccess: (beatId: string | undefined) => void,
  ) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const selected =
        data.profileId ?? data.workflowId ?? defaultProfileId;
      const payload: CreateBeatInput = selected
        ? { ...data, profileId: selected, workflowId: undefined }
        : data;
      const result = await createBeat(
        payload,
        repo ?? undefined,
      );
      if (result.ok) {
        if (deps && result.data?.id) {
          await addDepsForBeat(
            result.data.id,
            deps,
            repo ?? undefined,
          );
        }
        onSuccess(result.data?.id);
      } else {
        toast.error(result.error ?? "Failed to create");
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return { isSubmitting, submitBeat };
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
  const queryClient = useQueryClient();
  const { workflows, defaultProfileId, isKnotsBackend } =
    useCreateBeatQueries(open, repo);
  const { isSubmitting, submitBeat } =
    useSubmitBeat(repo, defaultProfileId);

  function navigateToBeat(beatId: string) {
    router.push(
      buildBeatFocusHref(beatId, searchParams.toString(), {
        detailRepo: repo,
      }),
    );
  }

  function handleSubmit(
    data: CreateBeatInput,
    deps?: RelationshipDeps,
  ) {
    return submitBeat(data, deps, (beatId) => {
      const short = beatId ? stripBeatPrefix(beatId) : "";
      const msg = beatId
        ? `Created beat ${beatId}`
        : `Created ${short}`;
      toast.success(msg, {
        action: buildToastAction(beatId, navigateToBeat),
      });
      onCreated();
    });
  }

  function handleCreateMore(
    data: CreateBeatInput,
    deps?: RelationshipDeps,
  ) {
    return submitBeat(data, deps, (beatId) => {
      const short = beatId ? stripBeatPrefix(beatId) : "";
      const msg = beatId
        ? `Created beat ${beatId} — ready for another`
        : `Created ${short} — ready for another`;
      toast.success(msg, {
        action: buildToastAction(beatId, navigateToBeat),
      });
      clearDraft();
      setFormKey((k) => k + 1);
      queryClient.invalidateQueries({ queryKey: ["beats"] });
    });
  }

  function handleClear() {
    clearDraft();
    setFormKey((k) => k + 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Create New</DialogTitle>
          <DialogDescription>
            Add a new issue or task to your project.
          </DialogDescription>
        </DialogHeader>
        <BeatForm
          key={`${formKey}-${defaultProfileId ?? ""}`}
          mode="create"
          workflows={workflows}
          hideTypeSelector={isKnotsBackend}
          defaultValues={{
            profileId: defaultProfileId,
            workflowId: undefined,
          }}
          onSubmit={handleSubmit}
          onCreateMore={handleCreateMore}
          onClear={handleClear}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}
