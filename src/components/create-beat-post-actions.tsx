"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Scissors, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchBeat } from "@/lib/api";
import { canTakeBeat } from "@/lib/beat-take-eligibility";
import { canTakeAfterGrooming } from "@/lib/grooming-status";
import { startBeatSession } from "@/lib/start-beat-session";
import { useBeatGrooming } from "@/lib/use-beat-grooming";

interface CreateBeatPostActionsProps {
  beatId: string;
  title: string;
  repo?: string | null;
  onDone: () => void;
}

function statusText(
  status: ReturnType<typeof useBeatGrooming>["status"],
  error: string | undefined,
): string {
  if (status === "idle") return "Ready to groom.";
  if (status === "queued") return "Grooming queued.";
  if (status === "running") return "Grooming in progress.";
  if (status === "completed") return "Grooming complete.";
  return error ?? "Grooming failed.";
}

interface PostActionButtonsProps {
  grooming: ReturnType<typeof useBeatGrooming>;
  isTaking: boolean;
  canStartTake: boolean;
  groomed: boolean;
  onTake: () => void;
}

function PostActionButtons({
  grooming,
  isTaking,
  canStartTake,
  groomed,
  onTake,
}: PostActionButtonsProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button
        type="button"
        variant="secondary"
        className="flex-1"
        onClick={() => void grooming.startGroom()}
        disabled={grooming.status !== "idle"}
      >
        {grooming.isGrooming ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Scissors className="size-4" />
        )}
        {grooming.isGrooming ? "Grooming..." : "Groom"}
      </Button>
      <Button
        type="button"
        className="flex-1"
        onClick={() => void onTake()}
        disabled={!canStartTake}
        title={
          groomed
            ? "Start work on this beat"
            : "Available after grooming completes"
        }
      >
        {isTaking ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Terminal className="size-4" />
        )}
        {isTaking ? "Taking..." : "Take"}
      </Button>
    </div>
  );
}

export function CreateBeatPostActions({
  beatId,
  title,
  repo,
  onDone,
}: CreateBeatPostActionsProps) {
  const [takeError, setTakeError] = useState<string | undefined>();
  const [isTaking, setIsTaking] = useState(false);
  const grooming = useBeatGrooming(beatId, repo);
  const beatQuery = useQuery({
    queryKey: ["beat", beatId, repo ?? "__default__"],
    queryFn: () => fetchBeat(beatId, repo ?? undefined),
  });

  const beat = beatQuery.data?.ok ? beatQuery.data.data : undefined;
  const beatError = beatQuery.data?.ok === false
    ? beatQuery.data.error ?? "Failed to load beat"
    : undefined;
  const takeEligible = useMemo(
    () => (beat ? canTakeBeat(beat) : false),
    [beat],
  );
  const groomed = canTakeAfterGrooming(grooming.status);
  const canStartTake =
    groomed && takeEligible && !isTaking && !beatError;
  const shownError = grooming.error ?? beatError ?? takeError;

  async function handleTake() {
    if (!canStartTake) return;
    setIsTaking(true);
    setTakeError(undefined);
    const result = await startBeatSession({
      beatId,
      beatTitle: beat?.title ?? title,
      repo: repo ?? undefined,
    });
    setIsTaking(false);
    if (!result.ok) {
      const message =
        result.error ?? "Failed to start terminal session";
      setTakeError(message);
      toast.error(message);
      return;
    }
    toast.success("Take started");
    onDone();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/70 bg-muted/30 p-3">
        <div className="text-sm font-semibold text-foreground">
          {title}
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          {beatId}
        </div>
      </div>
      <PostActionButtons
        grooming={grooming}
        isTaking={isTaking}
        canStartTake={canStartTake}
        groomed={groomed}
        onTake={handleTake}
      />
      <div
        className={
          shownError
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"
        }
      >
        {shownError ?? statusText(grooming.status, grooming.error)}
      </div>
    </div>
  );
}
