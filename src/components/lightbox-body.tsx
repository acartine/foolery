"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Beat, BeatDependency } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import { BeatDetail } from "@/components/beat-detail";
import { DepTree } from "@/components/dep-tree";
import { RelationshipPicker } from "@/components/relationship-picker";

// ── Handoff Capsules (collapsible, reverse-chronological) ──

function formatCapsuleDate(dateStr: unknown): string {
  if (typeof dateStr !== "string") return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HandoffCapsules({ beat }: { beat: Beat }) {
  const capsules = beat.metadata?.knotsHandoffCapsules;
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<
    number | null
  >(null);

  if (
    !Array.isArray(capsules) || capsules.length === 0
  ) return null;

  const reversed = [
    ...capsules,
  ].reverse() as Array<Record<string, unknown>>;

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        onClick={() => setSectionOpen((v) => !v)}
      >
        {sectionOpen ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        Handoff Capsules ({reversed.length})
      </button>

      {sectionOpen && (
        <CapsuleList
          capsules={reversed}
          expandedIdx={expandedIdx}
          setExpandedIdx={setExpandedIdx}
        />
      )}
    </section>
  );
}

function CapsuleList({
  capsules,
  expandedIdx,
  setExpandedIdx,
}: {
  capsules: Array<Record<string, unknown>>;
  expandedIdx: number | null;
  setExpandedIdx: (idx: number | null) => void;
}) {
  return (
    <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-0.5">
      {capsules.map((cap, i) => (
        <CapsuleCard
          key={i}
          cap={cap}
          isExpanded={expandedIdx === i}
          onToggle={() =>
            setExpandedIdx(
              expandedIdx === i ? null : i,
            )
          }
        />
      ))}
    </div>
  );
}

function CapsuleCard({
  cap,
  isExpanded,
  onToggle,
}: {
  cap: Record<string, unknown>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const content =
    typeof cap.content === "string"
      ? cap.content
      : typeof cap.summary === "string"
        ? cap.summary
        : typeof cap.message === "string"
          ? cap.message
          : null;
  const agent =
    typeof cap.agentname === "string"
      ? cap.agentname
      : null;
  const model =
    typeof cap.model === "string" ? cap.model : null;
  const version =
    typeof cap.version === "string"
      ? cap.version
      : null;
  const date = formatCapsuleDate(cap.datetime);

  const agentLabel = [agent, model, version]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-md border border-border/70 bg-background/50 text-xs">
      <button
        type="button"
        className="flex w-full items-start gap-1 px-2 py-1.5 text-left hover:bg-muted/40"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {date && (
            <span className="mr-1 font-medium text-foreground">
              {date}
            </span>
          )}
          {agentLabel ||
            (content
              ? content.slice(0, 60)
              : "capsule")}
        </span>
      </button>

      {isExpanded && content && (
        <div className="border-t border-border/50 px-2 py-1.5">
          <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground">
            {content}
          </p>
          {agentLabel && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {agentLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

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
  setBlocksIds: React.Dispatch<
    React.SetStateAction<string[]>
  >;
  setBlockedByIds: React.Dispatch<
    React.SetStateAction<string[]>
  >;
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
  setBlocksIds: React.Dispatch<
    React.SetStateAction<string[]>
  >;
  setBlockedByIds: React.Dispatch<
    React.SetStateAction<string[]>
  >;
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

      {beat && <HandoffCapsules beat={beat} />}

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
