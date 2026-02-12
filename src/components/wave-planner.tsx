"use client";

import { useQuery } from "@tanstack/react-query";
import { Rocket, AlertTriangle, Shield, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BeadTypeBadge } from "@/components/bead-type-badge";
import { BeadStatusBadge } from "@/components/bead-status-badge";
import { BeadPriorityBadge } from "@/components/bead-priority-badge";
import { fetchWavePlan } from "@/lib/wave-api";
import { useAppStore } from "@/stores/app-store";
import type { WaveBead } from "@/lib/types";

interface WavePlannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShipBead?: (bead: WaveBead) => void;
}

function BeadCard({
  bead,
  onShip,
}: {
  bead: WaveBead;
  onShip?: (bead: WaveBead) => void;
}) {
  const shortId = bead.id.replace(/^[^-]+-/, "");
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-3 min-w-[220px] max-w-[300px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {shortId}
        </span>
        <div className="flex items-center gap-1">
          <BeadPriorityBadge priority={bead.priority} />
          <BeadTypeBadge type={bead.type} />
        </div>
      </div>
      <p className="text-sm font-medium leading-tight line-clamp-2">
        {bead.title}
      </p>
      <div className="flex items-center justify-between gap-2">
        <BeadStatusBadge status={bead.status} />
        {onShip && bead.status !== "closed" && bead.type !== "gate" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => onShip(bead)}
          >
            <Rocket className="size-3" />
            Ship
          </Button>
        )}
      </div>
      {bead.blockedBy.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          Blocked by:{" "}
          {bead.blockedBy.map((id) => id.replace(/^[^-]+-/, "")).join(", ")}
        </div>
      )}
    </div>
  );
}

export function WavePlanner({ open, onOpenChange, onShipBead }: WavePlannerProps) {
  const { activeRepo } = useAppStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ["wave-plan", activeRepo],
    queryFn: () => fetchWavePlan(activeRepo ?? undefined),
    enabled: open,
    refetchOnWindowFocus: false,
  });

  const plan = data?.ok ? data.data : null;

  const handleShip = (bead: WaveBead) => {
    onOpenChange(false);
    onShipBead?.(bead);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5" />
            Wave Planner
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            Computing waves...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-8 text-red-500">
            Failed to compute wave plan
          </div>
        )}

        {plan && (
          <div className="space-y-4">
            {plan.waves.map((wave) => (
              <div
                key={wave.level}
                className="rounded-lg border bg-muted/30 p-3"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    Wave {wave.level}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {wave.beads.length} bead{wave.beads.length !== 1 ? "s" : ""}
                  </span>
                  {wave.gate && (
                    <Badge
                      variant="secondary"
                      className="gap-1 bg-amber-100 text-amber-800"
                    >
                      <Shield className="size-3" />
                      Gate: {wave.gate.title}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {wave.beads.map((bead) => (
                    <BeadCard
                      key={bead.id}
                      bead={bead}
                      onShip={handleShip}
                    />
                  ))}
                </div>
              </div>
            ))}

            {plan.unschedulable.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-red-700">
                  <AlertTriangle className="size-4" />
                  <span className="text-sm font-medium">
                    Circular Dependencies ({plan.unschedulable.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {plan.unschedulable.map((bead) => (
                    <BeadCard key={bead.id} bead={bead} />
                  ))}
                </div>
              </div>
            )}

            {plan.waves.length === 0 && plan.unschedulable.length === 0 && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                No open beads to plan
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
