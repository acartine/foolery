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
import { AlertTriangle, Undo2 } from "lucide-react";
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

function WorkflowStateDropdown({
  beat,
  workflow,
  fireUpdate,
}: {
  beat: Beat;
  workflow: MemoryWorkflowDescriptor;
  fireUpdate: (fields: UpdateBeatInput) => void;
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
}: {
  beat: Beat;
  onUpdate?: (f: UpdateBeatInput) => Promise<void>;
  workflow?: MemoryWorkflowDescriptor | null;
  fireUpdate: (f: UpdateBeatInput) => void;
}) {
  if (onUpdate && workflow && beat.state) {
    return (
      <WorkflowStateDropdown
        beat={beat}
        workflow={workflow}
        fireUpdate={fireUpdate}
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
