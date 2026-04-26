"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { Beat } from "@/lib/types";
import { BeatStateBadge } from "@/components/beat-state-badge";
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
import {
  Clapperboard,
  Square,
  Undo2,
  Wrench,
} from "lucide-react";
import {
  builtinProfileDescriptor,
  isRollbackTransition,
} from "@/lib/workflows";
import { canTakeBeat } from "@/lib/beat-take-eligibility";
import {
  validNextStates,
} from "./beat-column-states";
import type {
  AgentInfo,
} from "./beat-column-types";
import {
  formatStateName,
  repoPathForBeat,
} from "./beat-column-helpers";
import type { ResolvedOpts } from "./beat-column-defs";

export function stateColumn(
  r: ResolvedOpts,
): ColumnDef<Beat> {
  return {
    accessorKey: "state",
    header: "State",
    size: 120,
    minSize: 100,
    maxSize: 150,
    meta: { minWidthPx: 100 },
    cell: ({ row }) => {
      const beatId = row.original.id;
      const isRolling = Boolean(
        r.shippingByBeatId[beatId],
      );
      const isParentRolling =
        r.parentRollingBeatIds.has(beatId);
      const inherited =
        isRolling || isParentRolling;
      const state = row.original.state;
      const isTerminal =
        state === "shipped"
        || state === "abandoned"
        || state === "closed";
      const pulse =
        inherited && !isTerminal
          ? "animate-pulse"
          : "";
      return (
        <div className="flex items-center gap-0.5">
          {r.onUpdateBeat && !inherited
            ? renderStateDropdown(
              row.original,
              state,
              pulse,
              r,
            )
            : (
              <BeatStateBadge
                state={state}
                className={pulse}
              />
            )}
        </div>
      );
    },
  };
}

function renderStateDropdown(
  beat: Beat,
  state: string,
  pulseClass: string,
  r: ResolvedOpts,
) {
  const workflow = builtinProfileDescriptor(
    beat.profileId,
  );
  const terminals = workflow.terminalStates ?? [];
  const rawKnoState =
    typeof beat.metadata?.knotsState === "string"
      ? beat.metadata.knotsState
      : undefined;
  const nextStates = validNextStates(
    state,
    workflow,
    rawKnoState,
  );
  const forward = nextStates.filter(
    (s) => !isRollbackTransition(state, s),
  );
  const rollback = nextStates.filter(
    (s) => isRollbackTransition(state, s),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Change state"
          className={
            `cursor-pointer ${pulseClass}`
          }
          onClick={(e) => e.stopPropagation()}
        >
          <BeatStateBadge state={state} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuRadioGroup
          value={state}
          onValueChange={(v) =>
            r.onUpdateBeat!(
              beat.id,
              { state: v },
              repoPathForBeat(beat),
            )
          }
        >
          <DropdownMenuRadioItem value={state}>
            {formatStateName(state)} (current)
          </DropdownMenuRadioItem>
          {forward.map((s) => (
            <DropdownMenuRadioItem
              key={s}
              value={s}
            >
              {formatStateName(s)}
            </DropdownMenuRadioItem>
          ))}
          {rollback.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel
                className={
                  "flex items-center gap-1"
                  + " text-xs text-muted-foreground"
                }
              >
                <Undo2 className="size-3" />
                Rollback
              </DropdownMenuLabel>
            </>
          )}
        {rollback.map((s) => (
          <DropdownMenuRadioItem
            key={s}
            value={s}
          >
            {formatStateName(s)}
          </DropdownMenuRadioItem>
        ))}
        </DropdownMenuRadioGroup>
        {renderTerminalCorrections(
          terminals,
          beat,
          r,
        )}
        {renderRewindCorrections(beat, workflow, r)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Rewind submenu — HACKISH FAT-FINGER CORRECTION, not a primary
 * workflow action. Lists every queue state strictly earlier than the
 * beat's current state and routes selection through the dedicated
 * `/rewind` API (kno's `force: true`). Mirrors the detail-view
 * RewindSubmenu so users can recover stuck/over-shot beats from
 * either the table dropdown or the detail dropdown.
 *
 * State sources are loom-derived: `workflow.states` and
 * `workflow.queueStates` come from kno's `profile list --json` via
 * `toDescriptor`. Nothing here hardcodes state names. See CLAUDE.md
 * §"State Classification Is Loom-Derived".
 */
function renderRewindCorrections(
  beat: Beat,
  workflow: ReturnType<typeof builtinProfileDescriptor>,
  r: ResolvedOpts,
) {
  if (!r.onRewindBeat) return null;
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
          "flex items-center gap-1"
          + " text-xs text-muted-foreground"
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
          onSelect={() =>
            r.onRewindBeat!(
              beat.id, s, repoPathForBeat(beat),
            )
          }
        >
          {formatStateName(s)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function renderTerminalCorrections(
  terminals: string[],
  beat: Beat,
  r: ResolvedOpts,
) {
  if (terminals.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel
        className={
          "flex items-center gap-1"
          + " text-xs text-muted-foreground"
        }
      >
        <Undo2 className="size-3" />
        Correction
      </DropdownMenuLabel>
      {terminals.map((terminal) => (
        <DropdownMenuItem
          key={`correction-${terminal}`}
          onSelect={() =>
            r.onUpdateBeat!(
              beat.id,
              { state: terminal },
              repoPathForBeat(beat),
            )
          }
        >
          {formatStateName(terminal)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function agentColumns(
  r: ResolvedOpts,
): ColumnDef<Beat>[] {
  const agentCell = (
    beatId: string,
    field: keyof AgentInfo,
  ) => {
    const info = r.agentInfoByBeatId[beatId];
    const value = info?.[field];
    if (!value) {
      return (
        <span
          className={
            "text-muted-foreground text-xs"
          }
        >
          &mdash;
        </span>
      );
    }
    return (
      <span
        className="text-xs font-mono truncate"
        title={value}
      >
        {value}
      </span>
    );
  };

  return [
    {
      id: "agentName",
      header: "Agent",
      size: 90,
      minSize: 70,
      maxSize: 120,
      enableSorting: false,
      cell: ({ row }) =>
        agentCell(row.original.id, "agentName"),
    },
    {
      id: "agentModel",
      header: "Model",
      size: 160,
      minSize: 120,
      maxSize: 220,
      enableSorting: false,
      cell: ({ row }) =>
        agentCell(row.original.id, "model"),
    },
    {
      id: "agentVersion",
      header: "Version",
      size: 90,
      minSize: 80,
      maxSize: 120,
      enableSorting: false,
      cell: ({ row }) =>
        agentCell(row.original.id, "version"),
    },
  ];
}

export function actionColumn(
  r: ResolvedOpts,
): ColumnDef<Beat> {
  return {
    id: "action",
    header: "Action",
    size: 100,
    minSize: 100,
    maxSize: 100,
    enableSorting: false,
    cell: ({ row }) => {
      const beat = row.original;
      const isTerminal =
        beat.state === "shipped"
        || beat.state === "abandoned"
        || beat.state === "closed";
      if (isTerminal) {
        return null;
      }
      const isActive = Boolean(
        r.shippingByBeatId[beat.id],
      );
      const isChild =
        r.parentRollingBeatIds.has(beat.id);
      const hb = beat as unknown as {
        _hasChildren?: boolean;
      };
      const isParent = hb._hasChildren ?? false;
      const label = isParent
        ? "Scene!"
        : "Take!";

      if (isActive) {
        return renderRollingActive(
          beat.id,
          r.onAbortShipping,
        );
      }
      if (isChild) {
        return (
          <span
            className={
              "text-xs font-semibold"
              + " text-moss-700 animate-pulse dark:text-moss-200"
            }
          >
            Rolling...
          </span>
        );
      }
      if (!canTakeBeat(beat)) {
        return null;
      }
      return renderShipButton(
        beat,
        label,
        isParent,
        r.onShipBeat!,
      );
    },
  };
}

function renderRollingActive(
  beatId: string,
  onAbort?: (id: string) => void,
) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        className={
          "text-xs font-semibold text-moss-700 dark:text-moss-200"
        }
      >
        Rolling...
      </span>
      <button
        type="button"
        title="Terminating"
        className={
          "inline-flex h-5 w-5 items-center"
          + " justify-center rounded bg-rust-500"
          + " text-white hover:bg-rust-500"
        }
        onClick={(e) => {
          e.stopPropagation();
          onAbort?.(beatId);
        }}
      >
        <Square className="size-3" />
      </button>
    </div>
  );
}

function renderShipButton(
  beat: Beat,
  label: string,
  isParent: boolean,
  onShipBeat: (beat: Beat) => void,
) {
  const color = isParent
    ? "text-clay-700 hover:bg-clay-100 dark:text-clay-200 dark:hover:bg-clay-700/30"
    : "text-lake-700 hover:bg-lake-100 dark:text-lake-100 dark:hover:bg-lake-700/30";
  return (
    <button
      type="button"
      className={
        "inline-flex items-center gap-1 rounded"
        + ` px-1.5 py-0.5 text-xs font-medium ${color}`
      }
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onShipBeat(beat);
      }}
    >
      <Clapperboard className="size-3" />
      {label}
    </button>
  );
}

export function repoColumn(): ColumnDef<Beat> {
  return {
    id: "_repoName",
    header: "Repo",
    size: 100,
    minSize: 100,
    maxSize: 100,
    cell: ({ row }) => {
      const repoName = (
        row.original as unknown as
          Record<string, unknown>
      )._repoName;
      return repoName ? (
        <span
          className={
            "text-xs font-mono"
            + " text-muted-foreground"
          }
        >
          {repoName as string}
        </span>
      ) : (
        "-"
      );
    },
  };
}
