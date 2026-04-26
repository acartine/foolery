import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, Undo2, Wrench } from "lucide-react";
import type {
  Beat,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import { isRollbackTransition } from "@/lib/workflows";
import type { UpdateBeatInput } from "@/lib/schemas";
import { BeatStateBadge } from "./beat-state-badge";
import { validNextStates, formatStateName } from "./beat-detail";

function CorrectionSubmenu({
  workflow,
  fireUpdate,
}: {
  workflow: MemoryWorkflowDescriptor;
  fireUpdate: (fields: UpdateBeatInput) => void;
}) {
  const terminals = workflow.terminalStates ?? [];
  if (terminals.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel
        className={
          "flex items-center gap-1 "
          + "text-xs text-muted-foreground"
        }
      >
        <AlertTriangle className="size-3" />
        Correction
      </DropdownMenuLabel>
      {terminals.map((s) => (
        <DropdownMenuItem
          key={`correction-${s}`}
          onSelect={() => fireUpdate({ state: s })}
        >
          {formatStateName(s)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * Rewind submenu — HACKISH FAT-FINGER CORRECTION, not a primary
 * workflow action. Lists every queue state strictly earlier than the
 * beat's current state and routes selection through the dedicated
 * `/rewind` API (kno's `force: true`). Only rendered when at least one
 * earlier queue state exists. Use cases: a beat was over-shot forward
 * (e.g. accidentally Shipped) or orphaned in an action state with no
 * legal kno transition home. For normal forward moves, the radio
 * group above is the right tool.
 *
 * State sources are loom-derived: `workflow.states` and
 * `workflow.queueStates` come from kno's `profile list --json` output
 * via `toDescriptor` in `knots-backend-workflows.ts`. Nothing here
 * hardcodes state names or naming conventions.
 */
function RewindSubmenu({
  beat,
  workflow,
  fireRewind,
}: {
  beat: Beat;
  workflow: MemoryWorkflowDescriptor;
  fireRewind?: (targetState: string) => void;
}) {
  if (!fireRewind) return null;
  const states = workflow.states ?? [];
  const queueStateSet = new Set(workflow.queueStates ?? []);
  if (queueStateSet.size === 0) return null;
  const rawKnoState =
    typeof beat.metadata?.knotsState === "string"
      ? beat.metadata.knotsState.trim().toLowerCase()
      : beat.state.trim().toLowerCase();
  const currentIndex = states.indexOf(rawKnoState);
  if (currentIndex <= 0) return null;
  const earlier = states
    .slice(0, currentIndex)
    .filter((s) => queueStateSet.has(s));
  if (earlier.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel
        className={
          "flex items-center gap-1 "
          + "text-xs text-muted-foreground"
        }
        title={
          "Fat-finger recovery: force a beat backward to an earlier "
          + "queue state when no kno-sanctioned transition can walk "
          + "it home. Not a primary workflow action."
        }
      >
        <Wrench className="size-3" />
        Rewind (correction)
      </DropdownMenuLabel>
      {earlier.map((s) => (
        <DropdownMenuItem
          key={`rewind-${s}`}
          onSelect={() => fireRewind(s)}
        >
          {formatStateName(s)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function WorkflowStateDropdown({
  beat,
  workflow,
  fireUpdate,
  fireRewind,
}: {
  beat: Beat;
  workflow: MemoryWorkflowDescriptor;
  fireUpdate: (fields: UpdateBeatInput) => void;
  fireRewind?: (targetState: string) => void;
}) {
  const rawKnoState =
    typeof beat.metadata?.knotsState === "string"
      ? beat.metadata.knotsState
      : undefined;
  const nextStates = validNextStates(
    beat.state, workflow, rawKnoState,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Change workflow state"
          className="cursor-pointer"
        >
          <BeatStateBadge state={beat.state} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={beat.state}
          onValueChange={(v) =>
            fireUpdate({ state: v })
          }
        >
          <DropdownMenuRadioItem value={beat.state}>
            {formatStateName(beat.state)} (current)
          </DropdownMenuRadioItem>
          {nextStates
            .filter((s) =>
              !isRollbackTransition(beat.state, s))
            .map((s) => (
              <DropdownMenuRadioItem
                key={s}
                value={s}
              >
                {formatStateName(s)}
              </DropdownMenuRadioItem>
            ))}
          {nextStates.some((s) =>
            isRollbackTransition(beat.state, s),
          ) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel
                className={
                  "flex items-center gap-1 "
                  + "text-xs text-muted-foreground"
                }
              >
                <Undo2 className="size-3" />
                Rollback
              </DropdownMenuLabel>
            </>
          )}
          {nextStates
            .filter((s) =>
              isRollbackTransition(beat.state, s))
            .map((s) => (
              <DropdownMenuRadioItem
                key={s}
                value={s}
              >
                {formatStateName(s)}
              </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
        <CorrectionSubmenu
          workflow={workflow}
          fireUpdate={fireUpdate}
        />
        <RewindSubmenu
          beat={beat}
          workflow={workflow}
          fireRewind={fireRewind}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SIMPLE_STATES = [
  "open", "in_progress", "blocked",
  "deferred", "closed",
] as const;

function SimpleStateDropdown({
  beat,
  fireUpdate,
}: {
  beat: Beat;
  fireUpdate: (fields: UpdateBeatInput) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Change beat state"
          className="cursor-pointer"
        >
          <BeatStateBadge state={beat.state} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={beat.state}
          onValueChange={(v) =>
            fireUpdate({ state: v })
          }
        >
          {SIMPLE_STATES.map((s) => (
            <DropdownMenuRadioItem
              key={s}
              value={s}
            >
              {s.replace("_", " ")}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StateDropdown({
  beat,
  onUpdate,
  workflow,
  fireUpdate,
  fireRewind,
}: {
  beat: Beat;
  onUpdate?: (f: UpdateBeatInput) => Promise<void>;
  workflow?: MemoryWorkflowDescriptor | null;
  fireUpdate: (f: UpdateBeatInput) => void;
  fireRewind?: (targetState: string) => void;
}) {
  if (onUpdate && workflow && beat.state) {
    return (
      <WorkflowStateDropdown
        beat={beat}
        workflow={workflow}
        fireUpdate={fireUpdate}
        fireRewind={fireRewind}
      />
    );
  }
  if (onUpdate) {
    return (
      <SimpleStateDropdown
        beat={beat}
        fireUpdate={fireUpdate}
      />
    );
  }
  return <BeatStateBadge state={beat.state} />;
}
