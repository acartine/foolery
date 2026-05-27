"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { Beat } from "@/lib/types";
import {
  selectColumn,
  idColumn,
  priorityColumn,
  profileColumn,
  ownerTypeColumn,
  resolveOpts,
} from "./beat-column-defs";
import {
  stateColumn,
  agentColumns,
  actionColumn,
  verificationStepsColumn,
} from "./beat-column-defs-extra";
import {
  repoColumn,
} from "./beat-columns-repo";

export type {
  AgentInfo,
  BeatColumnOpts,
} from "./beat-column-types";
export {
  validNextStates,
} from "./beat-column-states";

export function getBeatColumns(
  opts:
    | import("./beat-column-types").BeatColumnOpts
    | boolean = false,
): ColumnDef<Beat>[] {
  const showRepo =
    typeof opts === "boolean"
      ? opts
      : (opts.showRepoColumn ?? false);
  const showAgent =
    typeof opts === "boolean"
      ? false
      : (opts.showAgentColumns ?? false);
  const isActive = showAgent;
  const r = resolveOpts(opts);

  const columns: ColumnDef<Beat>[] = [
    selectColumn(),
    idColumn(),
    priorityColumn(r),
    verificationStepsColumn(),
    profileColumn(r),
  ];

  columns.push(ownerTypeColumn());
  columns.push(stateColumn(r));

  if (showAgent) {
    columns.push(...agentColumns(r));
  }

  if (r.onShipBeat && !isActive) {
    columns.push(actionColumn(r));
  }

  if (showRepo) {
    columns.splice(1, 0, repoColumn());
  }

  return columns;
}

export const beatColumns = getBeatColumns({
  showRepoColumn: false,
});
