"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clapperboard,
  AlertTriangle,
  Shield,
  Layers,
  PlayCircle,
  PauseCircle,
  Gauge,
  Workflow,
  Square,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BeadTypeBadge } from "@/components/bead-type-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
import { fetchWavePlan } from "@/lib/wave-api";
import { useAppStore } from "@/stores/app-store";
import type { Wave, WaveBead, WaveReadiness } from "@/lib/types";

interface WavePlannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShipBead?: (bead: WaveBead) => void;
  onAbortShip?: (beadId: string) => void;
  shippingByBeadId?: Record<string, string>;
}

const READINESS_STYLES: Record<WaveReadiness, string> = {
  runnable: "border-emerald-300 bg-emerald-50/70",
  in_progress: "border-sky-300 bg-sky-50/70",
  blocked: "border-amber-300 bg-amber-50/70",
  verification: "border-orange-300 bg-orange-50/70",
  gate: "border-zinc-300 bg-zinc-100/70",
  unschedulable: "border-red-300 bg-red-50/70",
};

const READINESS_LABELS: Record<WaveReadiness, string> = {
  runnable: "Ready",
  in_progress: "In Progress",
  blocked: "Blocked",
  verification: "Verification",
  gate: "Gate",
  unschedulable: "Cycle",
};

function shortId(id: string): string {
  return id.replace(/^[^-]+-/, "");
}

function canShipBead(
  bead: WaveBead,
  shippingByBeadId: Record<string, string>
): boolean {
  if (shippingByBeadId[bead.id]) return false;
  return bead.readiness === "runnable";
}

function BeadCard({
  bead,
  onShip,
  onAbortShip,
  shippingByBeadId,
}: {
  bead: WaveBead;
  onShip?: (bead: WaveBead) => void;
  onAbortShip?: (beadId: string) => void;
  shippingByBeadId: Record<string, string>;
}) {
  const isActiveShipping = Boolean(shippingByBeadId[bead.id]);
  const isShipDisabled = !canShipBead(bead, shippingByBeadId);

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-3 shadow-sm ${READINESS_STYLES[bead.readiness]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {shortId(bead.id)}
        </span>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px]">
            {READINESS_LABELS[bead.readiness]}
          </Badge>
          <BeadPriorityBadge priority={bead.priority} />
          <BeadTypeBadge type={bead.type} />
        </div>
      </div>

      <p className="text-sm font-semibold leading-tight line-clamp-2">
        {bead.title}
      </p>

      <p className="text-[11px] leading-tight text-muted-foreground">
        {bead.readinessReason}
      </p>

      {bead.blockedBy.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bead.blockedBy.map((id) => (
            <Badge key={id} variant="outline" className="text-[10px]">
              waits:{shortId(id)}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-0.5 flex items-center justify-between">
        <Badge variant="secondary" className="text-[10px]">
          wave {bead.waveLevel ?? "-"}
        </Badge>

        {onShip && bead.type !== "gate" && (
          <div className="flex items-center gap-1">
            {isActiveShipping ? (
              <>
                <span className="text-xs font-semibold text-green-700">
                  Rolling...
                </span>
                <button
                  type="button"
                  title="Terminating"
                    className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-600 text-white hover:bg-red-500"
                    onClick={() => onAbortShip?.(bead.id)}
                  >
                    <Square className="size-3" />
                  </button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-xs"
                disabled={isShipDisabled}
                onClick={() => onShip(bead)}
                title={
                  isShipDisabled
                    ? bead.readinessReason
                    : "Take! this beat"
                }
              >
                <Clapperboard className="size-3" />
                Take!
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getWaveNextCandidate(wave: Wave): WaveBead | undefined {
  return wave.beads
    .filter((bead) => bead.readiness === "runnable")
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    })[0];
}

export function WavePlanner({
  open,
  onOpenChange,
  onShipBead,
  onAbortShip,
  shippingByBeadId = {},
}: WavePlannerProps) {
  const { activeRepo, registeredRepos } = useAppStore();

  const repoLabel = useMemo(() => {
    if (!activeRepo) return "No repository selected";
    return (
      registeredRepos.find((repo) => repo.path === activeRepo)?.name ?? activeRepo
    );
  }, [activeRepo, registeredRepos]);

  const canPlan = Boolean(activeRepo);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wave-plan", activeRepo],
    queryFn: () => fetchWavePlan(activeRepo ?? undefined),
    enabled: open && canPlan,
    refetchOnWindowFocus: false,
  });

  const plan = data?.ok ? data.data : null;

  const recommendationBead = useMemo(() => {
    if (!plan?.recommendation) return null;
    const byId = new Map(plan.waves.flatMap((wave) => wave.beads).map((bead) => [bead.id, bead]));
    return byId.get(plan.recommendation.beadId) ?? null;
  }, [plan]);

  const shipBead = (bead: WaveBead) => {
    onOpenChange(false);
    onShipBead?.(bead);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[84vh] overflow-y-auto p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5 text-blue-600" />
            Orchestration
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pipeline view for <span className="font-semibold text-foreground">{repoLabel}</span>
          </p>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          {!canPlan && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Select a single repository first. Orchestration needs a concrete dependency graph.
            </div>
          )}

          {isLoading && canPlan && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              Computing execution waves...
            </div>
          )}

          {error && canPlan && (
            <div className="flex items-center justify-center py-10 text-red-600">
              Failed to compute wave plan
            </div>
          )}

          {plan && canPlan && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <PlayCircle className="size-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Runnable</span>
                  </div>
                  <p className="mt-1 text-2xl font-semibold">{plan.summary.runnable}</p>
                </div>
                <div className="rounded-xl border border-sky-300 bg-sky-50 p-3">
                  <div className="flex items-center gap-2 text-sky-700">
                    <Gauge className="size-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">In Progress</span>
                  </div>
                  <p className="mt-1 text-2xl font-semibold">{plan.summary.inProgress}</p>
                </div>
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-amber-700">
                    <PauseCircle className="size-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Blocked</span>
                  </div>
                  <p className="mt-1 text-2xl font-semibold">{plan.summary.blocked}</p>
                </div>
                <div className="rounded-xl border border-red-300 bg-red-50 p-3">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle className="size-4" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Cycles</span>
                  </div>
                  <p className="mt-1 text-2xl font-semibold">{plan.summary.unschedulable}</p>
                </div>
              </div>

              <div className="rounded-xl border bg-gradient-to-r from-blue-50 via-cyan-50 to-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      Recommended Next
                    </p>
                    {plan.recommendation ? (
                      <>
                        <p className="text-sm font-semibold">
                          {plan.recommendation.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Wave {plan.recommendation.waveLevel} · {plan.recommendation.reason}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No runnable beats available right now.
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={!recommendationBead || !canShipBead(recommendationBead, shippingByBeadId)}
                    onClick={() => recommendationBead && shipBead(recommendationBead)}
                  >
                    <Workflow className="size-3.5" />
                    Take! Next
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {plan.waves.map((wave) => {
                  const waveNext = getWaveNextCandidate(wave);
                  return (
                    <section
                      key={wave.level}
                      className="rounded-xl border bg-card p-3"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono">
                            Wave {wave.level}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {wave.beads.length} beat{wave.beads.length === 1 ? "" : "s"}
                          </span>
                          {wave.gate && (
                            <Badge variant="secondary" className="gap-1">
                              <Shield className="size-3" />
                              Gate {shortId(wave.gate.id)}
                            </Badge>
                          )}
                        </div>
                        {waveNext && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            disabled={!canShipBead(waveNext, shippingByBeadId)}
                            onClick={() => shipBead(waveNext)}
                          >
                            <Clapperboard className="size-3.5" />
                            Take! Next In Wave
                          </Button>
                        )}
                      </div>

                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {wave.beads.map((bead) => (
                          <BeadCard
                            key={bead.id}
                            bead={bead}
                            onShip={shipBead}
                            onAbortShip={onAbortShip}
                            shippingByBeadId={shippingByBeadId}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>

              {plan.unschedulable.length > 0 && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-red-700">
                    <AlertTriangle className="size-4" />
                    <span className="text-sm font-semibold">
                      Dependency cycles detected ({plan.unschedulable.length})
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {plan.unschedulable.map((bead) => (
                      <BeadCard
                        key={bead.id}
                        bead={bead}
                        shippingByBeadId={shippingByBeadId}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
