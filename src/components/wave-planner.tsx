"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchWavePlan } from "@/lib/wave-api";
import { useAppStore } from "@/stores/app-store";
import type { Wave, WaveBeat } from "@/lib/types";
import { PlanContent } from "@/components/wave-planner-sections";

interface WavePlannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShipBeat?: (beat: WaveBeat) => void;
  onAbortShip?: (beatId: string) => void;
  shippingByBeatId?: Record<string, string>;
}

function indexBeatAliases(
  plan: {
    waves: Wave[];
    unschedulable: WaveBeat[];
  } | null | undefined,
) {
  const aliases = new Map<string, string[] | undefined>();
  if (!plan) return aliases;

  for (const beat of plan.waves.flatMap((wave) => [
    ...wave.beats,
    ...(wave.gate ? [wave.gate] : []),
  ])) {
    aliases.set(beat.id, beat.aliases);
  }
  for (const beat of plan.unschedulable) {
    aliases.set(beat.id, beat.aliases);
  }

  return aliases;
}

export function WavePlanner({
  open,
  onOpenChange,
  onShipBeat,
  onAbortShip,
  shippingByBeatId = {},
}: WavePlannerProps) {
  const { activeRepo, registeredRepos } = useAppStore();

  const repoLabel = useMemo(() => {
    if (!activeRepo) return "No repository selected";
    const found = registeredRepos.find(
      (repo) => repo.path === activeRepo,
    );
    return found?.name ?? activeRepo;
  }, [activeRepo, registeredRepos]);

  const canPlan = Boolean(activeRepo);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wave-plan", activeRepo],
    queryFn: () => fetchWavePlan(activeRepo ?? undefined),
    enabled: open && canPlan,
    refetchOnWindowFocus: false,
  });

  const plan = data?.ok ? data.data : null;

  const recommendationBeat = useMemo(() => {
    if (!plan?.recommendation) return null;
    const byId = new Map(
      plan.waves
        .flatMap((w) => w.beats)
        .map((b) => [b.id, b]),
    );
    return (
      byId.get(plan.recommendation.beatId) ?? null
    );
  }, [plan]);

  const planBeatAliases = useMemo(
    () => indexBeatAliases(plan),
    [plan],
  );

  const shipBeat = (beat: WaveBeat) => {
    onOpenChange(false);
    onShipBeat?.(beat);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-6xl max-h-[84vh] overflow-y-auto p-0"
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5 text-blue-600" />
            Pipeline
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pipeline view for{" "}
            <span className="font-semibold text-foreground">
              {repoLabel}
            </span>
          </p>
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          {!canPlan && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Select a single repository first.
              Pipeline needs a concrete dependency graph.
            </div>
          )}
          {isLoading && canPlan && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              Computing execution scenes...
            </div>
          )}
          {error && canPlan && (
            <div className="flex items-center justify-center py-10 text-red-600">
              Failed to compute scene plan
            </div>
          )}
          {plan && canPlan && (
            <PlanContent
              plan={plan}
              recommendationBeat={recommendationBeat}
              planBeatAliases={planBeatAliases}
              shippingByBeatId={shippingByBeatId}
              onShip={shipBeat}
              onAbortShip={onAbortShip}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
