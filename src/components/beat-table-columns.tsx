"use client";

import { useMemo } from "react";
import type { useRouter, useSearchParams } from "next/navigation";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import type { AgentInfo } from "@/components/beat-columns";
import { getBeatColumns } from "@/components/beat-columns";
import { repoPathForBeat } from "@/components/beat-table-mutations";

type ColumnsParams = {
  showRepoColumn: boolean;
  showAgentColumns: boolean;
  agentInfoByBeatId: Record<string, AgentInfo>;
  handleUpdateBeat: (args: {
    id: string;
    fields: UpdateBeatInput;
    repoPath?: string;
  }) => void;
  onOpenBeat?: (beat: Beat) => void;
  searchParams: ReturnType<typeof useSearchParams>;
  router: ReturnType<typeof useRouter>;
  onShipBeat?: (beat: Beat) => void;
  shippingByBeatId: Record<string, string>;
  onAbortShipping?: (beatId: string) => void;
  allLabels: string[];
  initiateClose: (id: string) => void;
  collapsedIds: Set<string>;
  handleToggleCollapse: (id: string) => void;
  childCountMap: Map<string, number>;
  parentRollingBeatIds: Set<string>;
};

function buildTitleClick(
  onOpenBeat: ((beat: Beat) => void) | undefined,
  searchParams: ReturnType<typeof useSearchParams>,
  router: ReturnType<typeof useRouter>,
) {
  return (beat: Beat) => {
    if (onOpenBeat) {
      onOpenBeat(beat);
      return;
    }
    const rp = repoPathForBeat(beat);
    const p = new URLSearchParams(
      searchParams.toString(),
    );
    p.set("beat", beat.id);
    if (rp) p.set("detailRepo", rp);
    else p.delete("detailRepo");
    const qs = p.toString();
    router.push(`/beats${qs ? `?${qs}` : ""}`);
  };
}

export function useBeatTableColumns(
  params: ColumnsParams,
) {
  const {
    showRepoColumn,
    showAgentColumns,
    agentInfoByBeatId,
    handleUpdateBeat,
    onOpenBeat,
    searchParams,
    router,
    onShipBeat,
    shippingByBeatId,
    onAbortShipping,
    allLabels,
    initiateClose,
    collapsedIds,
    handleToggleCollapse,
    childCountMap,
    parentRollingBeatIds,
  } = params;

  return useMemo(
    () =>
      getBeatColumns({
        showRepoColumn,
        showAgentColumns,
        agentInfoByBeatId,
        onUpdateBeat: (id, fields, repoPath) =>
          handleUpdateBeat({
            id, fields, repoPath,
          }),
        onTitleClick: buildTitleClick(
          onOpenBeat, searchParams, router,
        ),
        onShipBeat,
        shippingByBeatId,
        onAbortShipping,
        allLabels,
        onCloseBeat: initiateClose,
        collapsedIds,
        onToggleCollapse: handleToggleCollapse,
        childCountMap,
        parentRollingBeatIds,
      }),
    [
      showRepoColumn,
      showAgentColumns,
      agentInfoByBeatId,
      handleUpdateBeat,
      onOpenBeat,
      searchParams,
      router,
      onShipBeat,
      shippingByBeatId,
      onAbortShipping,
      allLabels,
      initiateClose,
      collapsedIds,
      handleToggleCollapse,
      childCountMap,
      parentRollingBeatIds,
    ],
  );
}
