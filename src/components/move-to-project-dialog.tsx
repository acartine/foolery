"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { createBead, closeBead } from "@/lib/api";
import { beadToCreateInput } from "@/lib/bead-utils";
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
import type { Bead } from "@/lib/types";

interface MoveToProjectDialogProps {
  bead: Bead;
  currentRepo?: string;
  onMoved: (newBeadId: string, targetRepo: string) => void;
}

export function MoveToProjectDialog({
  bead,
  currentRepo,
  onMoved,
}: MoveToProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [targetRepo, setTargetRepo] = useState<string>("");
  const { registeredRepos, setRegisteredRepos } = useAppStore();

  // Ensure registry is loaded (deduped with RepoSwitcher via query key)
  const { data: registryData } = useQuery({
    queryKey: ["registry"],
    queryFn: fetchRegistry,
  });

  useEffect(() => {
    if (registryData?.ok && registryData.data) {
      setRegisteredRepos(registryData.data);
    }
  }, [registryData, setRegisteredRepos]);

  const availableRepos = registeredRepos.filter(
    (r) => r.path !== currentRepo
  );

  const { mutate: handleMove, isPending } = useMutation({
    mutationFn: async () => {
      // Step 1: Create in target repo
      const createResult = await createBead(
        beadToCreateInput(bead),
        targetRepo
      );
      if (!createResult.ok || !createResult.data) {
        throw new Error(
          createResult.error ?? "Failed to create bead in target project"
        );
      }
      const newId = createResult.data.id;
      const targetName =
        availableRepos.find((r) => r.path === targetRepo)?.name ?? targetRepo;

      // Step 2: Close original
      const closeResult = await closeBead(
        bead.id,
        { reason: `Moved to ${targetName} as ${newId}` },
        currentRepo
      );
      if (!closeResult.ok) {
        toast.warning(
          `Bead created in ${targetName} (${newId}), but failed to close the original. Please close it manually.`
        );
      }

      return { newId, targetRepo };
    },
    onSuccess: ({ newId, targetRepo: repo }) => {
      toast.success("Bead moved successfully");
      setOpen(false);
      onMoved(newId, repo);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Hide when bead is already closed or no other projects available
  if (bead.status === "closed" || availableRepos.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setTargetRepo(""); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowRightLeft className="mr-2 h-4 w-4" />
          Move to Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Bead to Another Project</DialogTitle>
          <DialogDescription>
            This will create a copy in the target project and close the original
            with a reason indicating it was moved.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <label className="text-sm font-medium mb-2 block">
            Target Project
          </label>
          <Select value={targetRepo} onValueChange={setTargetRepo}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project..." />
            </SelectTrigger>
            <SelectContent>
              {availableRepos.map((repo) => (
                <SelectItem key={repo.path} value={repo.path}>
                  {repo.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleMove()}
            disabled={!targetRepo || isPending}
          >
            {isPending ? "Moving..." : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
