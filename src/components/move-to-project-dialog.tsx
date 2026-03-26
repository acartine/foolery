"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { createBeat, closeBeat } from "@/lib/api";
import { beatToCreateInput } from "@/lib/beat-utils";
import { fetchRegistry } from "@/lib/registry-api";
import { useAppStore } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Beat } from "@/lib/types";
import type { RegisteredRepo } from "@/lib/types";

interface MoveToProjectDialogProps {
  beat: Beat;
  currentRepo?: string;
  onMoved: (
    newBeatId: string, targetRepo: string
  ) => void;
}

const TERMINAL_STATES = [
  "shipped", "abandoned", "closed",
] as const;

function isTerminalBeat(beat: Beat): boolean {
  return TERMINAL_STATES.some((s) => beat.state === s);
}

function useMoveBeat(
  beat: Beat,
  targetRepo: string,
  availableRepos: RegisteredRepo[],
  currentRepo: string | undefined,
  onSuccess: (newId: string, repo: string) => void,
) {
  return useMutation({
    mutationFn: async () => {
      const createResult = await createBeat(
        beatToCreateInput(beat),
        targetRepo,
      );
      if (!createResult.ok || !createResult.data) {
        throw new Error(
          createResult.error
            ?? "Failed to create beat in target project",
        );
      }
      const newId = createResult.data.id;
      const targetName =
        availableRepos.find(
          (r) => r.path === targetRepo,
        )?.name ?? targetRepo;

      const closeResult = await closeBeat(
        beat.id,
        { reason: `Moved to ${targetName} as ${newId}` },
        currentRepo,
      );
      if (!closeResult.ok) {
        const msg =
          `Beat created in ${targetName} (${newId}),`
          + " but failed to close the original."
          + " Please close it manually.";
        toast.warning(msg);
      }

      return { newId, targetRepo };
    },
    onSuccess: ({ newId, targetRepo: repo }) => {
      toast.success("Beat moved successfully");
      onSuccess(newId, repo);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

function MoveDialogBody({
  availableRepos,
  targetRepo,
  setTargetRepo,
  isPending,
  onCancel,
  onMove,
}: {
  availableRepos: RegisteredRepo[];
  targetRepo: string;
  setTargetRepo: (v: string) => void;
  isPending: boolean;
  onCancel: () => void;
  onMove: () => void;
}) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          Move Beat to Another Project
        </DialogTitle>
        <DialogDescription>
          This will create a copy in the target project
          and close the original with a reason
          indicating it was moved.
        </DialogDescription>
      </DialogHeader>
      <div className="py-4">
        <label className="text-sm font-medium mb-2 block">
          Target Project
        </label>
        <Select
          value={targetRepo}
          onValueChange={setTargetRepo}
        >
          <SelectTrigger>
            <SelectValue
              placeholder="Select a project..."
            />
          </SelectTrigger>
          <SelectContent>
            {availableRepos.map((repo) => (
              <SelectItem
                key={repo.path}
                value={repo.path}
              >
                {repo.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button
          title="Cancel move"
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          title="Move beat to selected project"
          onClick={onMove}
          disabled={!targetRepo || isPending}
        >
          {isPending ? "Moving..." : "Move"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function MoveToProjectDialog({
  beat,
  currentRepo,
  onMoved,
}: MoveToProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [targetRepo, setTargetRepo] = useState("");
  const {
    registeredRepos, setRegisteredRepos,
  } = useAppStore();

  const { data: registryData } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (registryData?.ok && registryData.data) {
      setRegisteredRepos(registryData.data);
    }
  }, [registryData, setRegisteredRepos]);

  const availableRepos = registeredRepos.filter(
    (r) => r.path !== currentRepo,
  );

  const handleSuccess = (
    newId: string, repo: string,
  ) => {
    setOpen(false);
    onMoved(newId, repo);
  };

  const { mutate: handleMove, isPending } = useMoveBeat(
    beat, targetRepo, availableRepos,
    currentRepo, handleSuccess,
  );

  if (isTerminalBeat(beat) || !availableRepos.length) {
    return null;
  }

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) setTargetRepo("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          title="Move this beat to another project"
          size="xs"
        >
          <ArrowRightLeft />
          Move
        </Button>
      </DialogTrigger>
      <MoveDialogBody
        availableRepos={availableRepos}
        targetRepo={targetRepo}
        setTargetRepo={setTargetRepo}
        isPending={isPending}
        onCancel={() => setOpen(false)}
        onMove={() => handleMove()}
      />
    </Dialog>
  );
}
