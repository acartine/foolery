import {
  Clapperboard,
  AlertTriangle,
  Shield,
  PlayCircle,
  PauseCircle,
  Gauge,
  Workflow,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BeatTypeBadge } from "@/components/beat-type-badge";
import { BeatPriorityBadge } from "@/components/beat-priority-badge";
import { displayBeatLabel } from "@/lib/beat-display";
import type {
  Wave,
  WaveBeat,
  WavePlan,
  WaveReadiness,
  WaveSummary,
} from "@/lib/types";

export type AliasMap = ReadonlyMap<
  string,
  readonly string[] | undefined
>;

const READINESS_STYLES: Record<WaveReadiness, string> = {
  runnable: "border-moss-200 bg-moss-100/70",
  in_progress: "border-lake-400 bg-lake-100/70",
  blocked: "border-feature-400 bg-feature-100/70",
  humanAction: "border-ochre-400 bg-ochre-100/70",
  gate: "border-zinc-300 bg-zinc-100/70",
  unschedulable: "border-rust-400 bg-rust-100/70",
};

const READINESS_LABELS: Record<WaveReadiness, string> = {
  runnable: "Ready",
  in_progress: "In Progress",
  blocked: "Blocked",
  humanAction: "Escalations",
  gate: "Gate",
  unschedulable: "Cycle",
};

function canShipBeat(
  beat: WaveBeat,
  shippingByBeatId: Record<string, string>,
): boolean {
  if (shippingByBeatId[beat.id]) return false;
  return beat.readiness === "runnable";
}

function BeatCard({
  beat,
  planBeatAliases,
  onShip,
  onAbortShip,
  shippingByBeatId,
}: {
  beat: WaveBeat;
  planBeatAliases: AliasMap;
  onShip?: (beat: WaveBeat) => void;
  onAbortShip?: (beatId: string) => void;
  shippingByBeatId: Record<string, string>;
}) {
  const isActiveShipping = Boolean(
    shippingByBeatId[beat.id],
  );
  const isShipDisabled = !canShipBeat(
    beat,
    shippingByBeatId,
  );

  return (
    <div
      className={
        "flex flex-col gap-2 rounded-xl border p-3 shadow-sm "
        + READINESS_STYLES[beat.readiness]
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {displayBeatLabel(beat.id, beat.aliases)}
        </span>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px]">
            {READINESS_LABELS[beat.readiness]}
          </Badge>
          <BeatPriorityBadge priority={beat.priority} />
          <BeatTypeBadge type={beat.type} />
        </div>
      </div>

      <p className="text-sm font-semibold leading-tight line-clamp-2">
        {beat.title}
      </p>

      <p className="text-[11px] leading-tight text-muted-foreground">
        {beat.readinessReason}
      </p>

      {beat.blockedBy.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {beat.blockedBy.map((id) => (
            <Badge
              key={id}
              variant="outline"
              className="text-[10px]"
            >
              waits:
              {displayBeatLabel(
                id,
                planBeatAliases.get(id),
              )}
            </Badge>
          ))}
        </div>
      )}

      <BeatCardActions
        beat={beat}
        isActiveShipping={isActiveShipping}
        isShipDisabled={isShipDisabled}
        onShip={onShip}
        onAbortShip={onAbortShip}
      />
    </div>
  );
}

function BeatCardActions({
  beat,
  isActiveShipping,
  isShipDisabled,
  onShip,
  onAbortShip,
}: {
  beat: WaveBeat;
  isActiveShipping: boolean;
  isShipDisabled: boolean;
  onShip?: (beat: WaveBeat) => void;
  onAbortShip?: (beatId: string) => void;
}) {
  return (
    <div className="mt-0.5 flex items-center justify-between">
      <Badge variant="secondary" className="text-[10px]">
        scene {beat.waveLevel ?? "-"}
      </Badge>

      {onShip && (
        <div className="flex items-center gap-1">
          {isActiveShipping ? (
            <>
              <span className="text-xs font-semibold text-moss-700">
                Rolling...
              </span>
              <button
                type="button"
                title="Terminating"
                className="inline-flex h-6 w-6 items-center justify-center rounded bg-rust-500 text-white hover:bg-rust-500"
                onClick={() => onAbortShip?.(beat.id)}
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
              onClick={() => onShip(beat)}
              title={
                isShipDisabled
                  ? beat.readinessReason
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
  );
}

function getWaveNextCandidate(
  wave: Wave,
): WaveBeat | undefined {
  return wave.beats
    .filter((beat) => beat.readiness === "runnable")
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.id.localeCompare(b.id);
    })[0];
}

export function SummaryGrid({
  summary,
}: {
  summary: WaveSummary;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-moss-200 bg-moss-100 p-3">
        <div className="flex items-center gap-2 text-moss-700">
          <PlayCircle className="size-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Runnable
          </span>
        </div>
        <p className="mt-1 text-2xl font-semibold">
          {summary.runnable}
        </p>
      </div>
      <div className="rounded-xl border border-lake-400 bg-lake-100 p-3">
        <div className="flex items-center gap-2 text-lake-700">
          <Gauge className="size-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            In Progress
          </span>
        </div>
        <p className="mt-1 text-2xl font-semibold">
          {summary.inProgress}
        </p>
      </div>
      <div className="rounded-xl border border-feature-400 bg-feature-100 p-3">
        <div className="flex items-center gap-2 text-feature-700">
          <PauseCircle className="size-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Blocked
          </span>
        </div>
        <p className="mt-1 text-2xl font-semibold">
          {summary.blocked}
        </p>
      </div>
      <div className="rounded-xl border border-rust-400 bg-rust-100 p-3">
        <div className="flex items-center gap-2 text-rust-700">
          <AlertTriangle className="size-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Cycles
          </span>
        </div>
        <p className="mt-1 text-2xl font-semibold">
          {summary.unschedulable}
        </p>
      </div>
    </div>
  );
}

export function RecommendationPanel({
  recommendation,
  recommendationBeat,
  shippingByBeatId,
  onShip,
}: {
  recommendation: WavePlan["recommendation"];
  recommendationBeat: WaveBeat | null;
  shippingByBeatId: Record<string, string>;
  onShip: (beat: WaveBeat) => void;
}) {
  const isDisabled =
    !recommendationBeat
    || !canShipBeat(
      recommendationBeat,
      shippingByBeatId,
    );

  return (
    <div className="rounded-xl border bg-gradient-to-r from-blue-50 via-cyan-50 to-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-lake-700">
            Recommended Next
          </p>
          {recommendation ? (
            <>
              <p className="text-sm font-semibold">
                {recommendation.title}
              </p>
              <p className="text-xs text-muted-foreground">
                Scene {recommendation.waveLevel}
                {" \u00b7 "}
                {recommendation.reason}
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
          disabled={isDisabled}
          onClick={() =>
            recommendationBeat
            && onShip(recommendationBeat)
          }
          title="Execute recommended next beat"
        >
          <Workflow className="size-3.5" />
          Take! Next
        </Button>
      </div>
    </div>
  );
}

export function WaveSection({
  wave,
  planBeatAliases,
  shippingByBeatId,
  onShip,
  onAbortShip,
}: {
  wave: Wave;
  planBeatAliases: AliasMap;
  shippingByBeatId: Record<string, string>;
  onShip: (beat: WaveBeat) => void;
  onAbortShip?: (beatId: string) => void;
}) {
  const waveNext = getWaveNextCandidate(wave);

  return (
    <section className="rounded-xl border bg-card p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            Scene {wave.level}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {wave.beats.length} beat
            {wave.beats.length === 1 ? "" : "s"}
          </span>
          {wave.gate && (
            <Badge
              variant="secondary"
              className="gap-1"
            >
              <Shield className="size-3" />
              Gate{" "}
              {displayBeatLabel(
                wave.gate.id,
                wave.gate.aliases,
              )}
            </Badge>
          )}
        </div>
        {waveNext && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={
              !canShipBeat(waveNext, shippingByBeatId)
            }
            onClick={() => onShip(waveNext)}
            title="Execute next beat in this scene"
          >
            <Clapperboard className="size-3.5" />
            Take! Next In Scene
          </Button>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {wave.beats.map((beat) => (
          <BeatCard
            key={beat.id}
            beat={beat}
            planBeatAliases={planBeatAliases}
            onShip={onShip}
            onAbortShip={onAbortShip}
            shippingByBeatId={shippingByBeatId}
          />
        ))}
      </div>
    </section>
  );
}

export function UnschedulableSection({
  beats,
  planBeatAliases,
  shippingByBeatId,
}: {
  beats: WaveBeat[];
  planBeatAliases: AliasMap;
  shippingByBeatId: Record<string, string>;
}) {
  if (beats.length === 0) return null;

  return (
    <div className="rounded-xl border border-rust-400 bg-rust-100 p-4">
      <div className="mb-2 flex items-center gap-2 text-rust-700">
        <AlertTriangle className="size-4" />
        <span className="text-sm font-semibold">
          Dependency cycles detected ({beats.length})
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {beats.map((beat) => (
          <BeatCard
            key={beat.id}
            beat={beat}
            planBeatAliases={planBeatAliases}
            shippingByBeatId={shippingByBeatId}
          />
        ))}
      </div>
    </div>
  );
}

export function PlanContent({
  plan,
  recommendationBeat,
  planBeatAliases,
  shippingByBeatId,
  onShip,
  onAbortShip,
}: {
  plan: WavePlan;
  recommendationBeat: WaveBeat | null;
  planBeatAliases: AliasMap;
  shippingByBeatId: Record<string, string>;
  onShip: (beat: WaveBeat) => void;
  onAbortShip?: (beatId: string) => void;
}) {
  return (
    <>
      <SummaryGrid summary={plan.summary} />
      <RecommendationPanel
        recommendation={plan.recommendation}
        recommendationBeat={recommendationBeat}
        shippingByBeatId={shippingByBeatId}
        onShip={onShip}
      />
      <div className="space-y-3">
        {plan.waves.map((wave) => (
          <WaveSection
            key={wave.level}
            wave={wave}
            planBeatAliases={planBeatAliases}
            shippingByBeatId={shippingByBeatId}
            onShip={onShip}
            onAbortShip={onAbortShip}
          />
        ))}
      </div>
      <UnschedulableSection
        beats={plan.unschedulable}
        planBeatAliases={planBeatAliases}
        shippingByBeatId={shippingByBeatId}
      />
    </>
  );
}
