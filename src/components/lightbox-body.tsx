"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Beat, BeatDependency } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import { BeatDetail } from "@/components/beat-detail";
import { DepTree } from "@/components/dep-tree";
import { HandoffCapsulesPanel } from "@/components/handoff-capsules-panel";
import { RelationshipPicker } from "@/components/relationship-picker";

// ── Body sub-component ──

export interface LightboxBodyProps {
  beat: Beat | null | undefined;
  beatWorkflow: MemoryWorkflowDescriptor | null;
  isLoadingBeat: boolean;
  handleUpdate: (
    fields: UpdateBeatInput,
  ) => Promise<void>;
  /** Hackish fat-finger correction; see `BeatDetailProps.onRewind`. */
  handleRewind: (targetState: string) => Promise<void>;
  deps: BeatDependency[];
  detailId: string;
  repo?: string;
  blocksIds: string[];
  blockedByIds: string[];
  setBlocksIds: Dispatch<SetStateAction<string[]>>;
  setBlockedByIds: Dispatch<SetStateAction<string[]>>;
  handleAddDep: (args: {
    source: string;
    target: string;
  }) => void;
}

export function LightboxBody({
  beat,
  beatWorkflow,
  isLoadingBeat,
  handleUpdate,
  handleRewind,
  deps,
  detailId,
  repo,
  blocksIds,
  blockedByIds,
  setBlocksIds,
  setBlockedByIds,
  handleAddDep,
}: LightboxBodyProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)] lg:grid-rows-1">
      <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-3 py-2">
        {isLoadingBeat && !beat ? (
          <div className="py-6 text-sm text-muted-foreground">
            Loading beat...
          </div>
        ) : beat ? (
          <BeatDetail
            beat={beat}
            workflow={beatWorkflow}
            onUpdate={async (fields) => {
              await handleUpdate(fields);
            }}
            onRewind={async (targetState) => {
              await handleRewind(targetState);
            }}
          />
        ) : (
          <div className="py-6 text-sm text-muted-foreground">
            Beat not found.
          </div>
        )}
      </div>

      <LightboxBodySidebar
        beat={beat}
        deps={deps}
        detailId={detailId}
        repo={repo}
        blocksIds={blocksIds}
        blockedByIds={blockedByIds}
        setBlocksIds={setBlocksIds}
        setBlockedByIds={setBlockedByIds}
        handleAddDep={handleAddDep}
      />
    </div>
  );
}

function LightboxBodySidebar({
  beat,
  deps,
  detailId,
  repo,
  blocksIds,
  blockedByIds,
  setBlocksIds,
  setBlockedByIds,
  handleAddDep,
}: {
  beat: Beat | null | undefined;
  deps: BeatDependency[];
  detailId: string;
  repo?: string;
  blocksIds: string[];
  blockedByIds: string[];
  setBlocksIds: Dispatch<SetStateAction<string[]>>;
  setBlockedByIds: Dispatch<SetStateAction<string[]>>;
  handleAddDep: (args: {
    source: string;
    target: string;
  }) => void;
}) {
  return (
    <aside className="min-h-0 min-w-0 space-y-3 overflow-y-auto overflow-x-hidden border-t border-border/70 bg-muted/20 px-3 py-2 lg:border-t-0 lg:border-l">
      <section className="space-y-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Dependencies
        </h3>
        <DepTree
          deps={deps}
          beatId={detailId}
          repo={repo}
        />
      </section>

      {beat && <HandoffCapsulesPanel beat={beat} />}

      {beat && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Add Relationship
          </h3>
          <RelationshipPicker
            label="This beat blocks"
            selectedIds={blocksIds}
            onAdd={(id) => {
              handleAddDep({
                source: detailId,
                target: id,
              });
              setBlocksIds((prev) => [...prev, id]);
            }}
            onRemove={(id) => {
              setBlocksIds((prev) =>
                prev.filter((x) => x !== id),
              );
            }}
            excludeId={detailId}
            repo={repo}
          />
          <RelationshipPicker
            label="This beat is blocked by"
            selectedIds={blockedByIds}
            onAdd={(id) => {
              handleAddDep({
                source: id,
                target: detailId,
              });
              setBlockedByIds((prev) => [
                ...prev,
                id,
              ]);
            }}
            onRemove={(id) => {
              setBlockedByIds((prev) =>
                prev.filter((x) => x !== id),
              );
            }}
            excludeId={detailId}
            repo={repo}
          />
        </section>
      )}
    </aside>
  );
}
