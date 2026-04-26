"use client";

import { useState } from "react";
import {
  Clapperboard,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { canTakeBeat } from "@/lib/beat-take-eligibility";
import { refineBeatScope } from "@/lib/api";
import {
  useScopeRefinementPendingStore,
  selectIsPending,
} from "@/stores/scope-refinement-pending-store";
import { MoveToProjectDialog } from "@/components/move-to-project-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LightboxBody } from "@/components/lightbox-body";
import { useBeatDetailData } from "@/components/use-beat-detail-data";

interface BeatDetailLightboxProps {
  open: boolean;
  beatId: string | null;
  repo?: string;
  initialBeat?: Beat | null;
  onOpenChange: (open: boolean) => void;
  onMoved: (
    newId: string,
    targetRepo: string,
  ) => void;
  onShipBeat?: (beat: Beat) => void;
  isParentRollingBeat?: (beat: Beat) => boolean;
}

type BeatWithRepoPath = Beat & {
  _repoPath?: string;
};

function normalizeRepoPath(
  repo: string | undefined,
): string | undefined {
  if (typeof repo !== "string") return undefined;
  const normalized = repo.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

export function getShipBeatPayload(
  beat: Beat,
  repo?: string,
): Beat {
  const normalizedRepo = normalizeRepoPath(repo);
  if (!normalizedRepo) return beat;

  const beatWithRepo = beat as BeatWithRepoPath;
  if (beatWithRepo._repoPath === normalizedRepo)
    return beat;

  return {
    ...beat,
    _repoPath: normalizedRepo,
  } as Beat;
}

export function BeatDetailLightbox({
  open,
  beatId,
  repo,
  initialBeat,
  onOpenChange,
  onMoved,
  onShipBeat,
  isParentRollingBeat,
}: BeatDetailLightboxProps) {
  const [blocksIds, setBlocksIds] = useState<
    string[]
  >([]);
  const [blockedByIds, setBlockedByIds] = useState<
    string[]
  >([]);
  const [isEditingTitle, setIsEditingTitle] =
    useState(false);
  const [editTitleValue, setEditTitleValue] =
    useState("");

  const detailId = beatId ?? "";

  const data = useBeatDetailData(
    open,
    detailId,
    repo,
    initialBeat,
  );

  if (!beatId) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setBlocksIds([]);
          setBlockedByIds([]);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[calc(100vh-1rem)] w-[95vw] max-w-[1600px] sm:max-w-[1600px] flex-col gap-0 overflow-hidden p-0"
      >
        <LightboxHeader
          beatId={beatId}
          beat={data.beat}
          isEditingTitle={isEditingTitle}
          editTitleValue={editTitleValue}
          setIsEditingTitle={setIsEditingTitle}
          setEditTitleValue={setEditTitleValue}
          handleUpdate={data.handleUpdate}
          onShipBeat={onShipBeat}
          isParentRollingBeat={
            isParentRollingBeat
          }
          repo={repo}
          onMoved={onMoved}
        />

        <LightboxBody
          beat={data.beat}
          beatWorkflow={data.beatWorkflow}
          isLoadingBeat={data.isLoadingBeat}
          handleUpdate={data.handleUpdate}
          handleRewind={data.handleRewind}
          deps={data.deps}
          detailId={detailId}
          repo={repo}
          blocksIds={blocksIds}
          blockedByIds={blockedByIds}
          setBlocksIds={setBlocksIds}
          setBlockedByIds={setBlockedByIds}
          handleAddDep={data.handleAddDep}
        />
      </DialogContent>
    </Dialog>
  );
}

export function getDisplayedBeatId(
  beatId: string,
  beat: Pick<Beat, "id"> | null | undefined,
): string {
  return beat?.id ?? beatId;
}

export function getDisplayedBeatAliases(
  beat:
    | Pick<Beat, "id" | "aliases">
    | null
    | undefined,
): string[] {
  if (!Array.isArray(beat?.aliases)) return [];

  const beatId = beat.id;
  const aliases = new Set<string>();
  for (const alias of beat.aliases) {
    if (typeof alias !== "string") continue;
    const normalized = alias.trim();
    if (!normalized || normalized === beatId)
      continue;
    aliases.add(normalized);
  }
  return Array.from(aliases);
}

// ── Shared click-to-copy ID chip ──

function ClickToCopyId({
  value,
  suffix,
}: {
  value: string;
  suffix?: string;
}) {
  return (
    <button
      type="button"
      className="cursor-pointer rounded px-0.5 hover:bg-muted/70"
      title="Click to copy"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => toast.success(`Copied: ${value}`),
          () =>
            toast.error(
              "Failed to copy to clipboard",
            ),
        );
      }}
    >
      {value}
      {suffix && (
        <span className="ml-1 text-muted-foreground">
          {suffix}
        </span>
      )}
    </button>
  );
}

// ── Header sub-component ──

interface LightboxHeaderProps {
  beatId: string;
  beat: Beat | null | undefined;
  isEditingTitle: boolean;
  editTitleValue: string;
  setIsEditingTitle: (v: boolean) => void;
  setEditTitleValue: (v: string) => void;
  handleUpdate: (
    fields: UpdateBeatInput,
  ) => Promise<void>;
  onShipBeat?: (beat: Beat) => void;
  isParentRollingBeat?: (beat: Beat) => boolean;
  repo?: string;
  onMoved: (
    newId: string,
    targetRepo: string,
  ) => void;
}

function LightboxHeader({
  beatId,
  beat,
  isEditingTitle,
  editTitleValue,
  setIsEditingTitle,
  setEditTitleValue,
  handleUpdate,
  onShipBeat,
  isParentRollingBeat,
  repo,
  onMoved,
}: LightboxHeaderProps) {
  const isInheritedRolling = beat
    ? (isParentRollingBeat?.(beat) ?? false)
    : false;
  const displayedBeatId = getDisplayedBeatId(
    beatId,
    beat,
  );
  const displayedAliases =
    getDisplayedBeatAliases(beat);

  return (
    <DialogHeader className="border-b border-border/70 px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <DialogDescription className="flex flex-wrap items-center gap-1 break-all font-mono text-[11px]">
            <ClickToCopyId
              value={displayedBeatId}
            />
            {displayedAliases.map((alias) => (
              <span
                key={alias}
                className="flex items-center gap-1"
              >
                <span className="text-muted-foreground">
                  |
                </span>
                <ClickToCopyId
                  value={alias}
                  suffix="(alias)"
                />
              </span>
            ))}
          </DialogDescription>
          <TitleEditor
            beat={beat}
            isEditing={isEditingTitle}
            editValue={editTitleValue}
            setIsEditing={setIsEditingTitle}
            setEditValue={setEditTitleValue}
            handleUpdate={handleUpdate}
          />
        </div>
        <DialogClose asChild>
          <Button variant="ghost" size="xs">
            Close
          </Button>
        </DialogClose>
      </div>
      {beat && (
        <HeaderActions
          beat={beat}
          isInheritedRolling={isInheritedRolling}
          onShipBeat={onShipBeat}
          repo={repo}
          onMoved={onMoved}
        />
      )}
    </DialogHeader>
  );
}

function TitleEditor({
  beat,
  isEditing,
  editValue,
  setIsEditing,
  setEditValue,
  handleUpdate,
}: {
  beat: Beat | null | undefined;
  isEditing: boolean;
  editValue: string;
  setIsEditing: (v: boolean) => void;
  setEditValue: (v: string) => void;
  handleUpdate: (
    fields: UpdateBeatInput,
  ) => Promise<void>;
}) {
  if (isEditing) {
    return (
      <input
        autoFocus
        value={editValue}
        onChange={(e) =>
          setEditValue(e.target.value)
        }
        onBlur={() => {
          const trimmed = editValue.trim();
          if (trimmed && trimmed !== beat?.title) {
            void handleUpdate({ title: trimmed });
          }
          setIsEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setIsEditing(false);
          }
        }}
        className="block w-full min-w-0 appearance-none border-0 bg-transparent px-0 py-0 text-base font-semibold leading-tight text-foreground outline-none shadow-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
      />
    );
  }

  return (
    <DialogTitle
      className="truncate text-base leading-tight cursor-pointer rounded px-0.5 hover:bg-muted/70"
      onClick={() => {
        if (beat) {
          setEditValue(beat.title);
          setIsEditing(true);
        }
      }}
    >
      {beat?.title ?? "Loading beat..."}
    </DialogTitle>
  );
}

export function isTerminalBeat(
  beat: Pick<Beat, "state">,
): boolean {
  return (
    beat.state === "shipped" ||
    beat.state === "abandoned" ||
    beat.state === "closed"
  );
}

function HeaderActions({
  beat,
  isInheritedRolling,
  onShipBeat,
  repo,
  onMoved,
}: {
  beat: Beat;
  isInheritedRolling: boolean;
  onShipBeat?: (beat: Beat) => void;
  repo?: string;
  onMoved: (
    newId: string,
    targetRepo: string,
  ) => void;
}) {
  const [isEnqueuing, setIsEnqueuing] =
    useState(false);
  const isPending =
    useScopeRefinementPendingStore(
      selectIsPending(beat.id),
    );
  const markPending =
    useScopeRefinementPendingStore(
      (s) => s.markPending,
    );
  const terminal = isTerminalBeat(beat);
  const refineDisabled =
    terminal || isEnqueuing || isPending;

  async function handleRefineScope() {
    setIsEnqueuing(true);
    const result = await refineBeatScope(
      beat.id,
      repo,
    );
    setIsEnqueuing(false);
    if (result.ok) {
      markPending(beat.id);
      toast.success("Scope refinement enqueued");
    } else {
      toast.error(
        result.error ?? "Failed to enqueue",
      );
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isInheritedRolling ? (
        <span className="text-xs font-semibold text-moss-700 animate-pulse dark:text-moss-200">
          Rolling...
        </span>
      ) : (
        <Button
          variant="outline"
          size="xs"
          title="Take! -- start a session for this beat"
          disabled={
            !onShipBeat || !canTakeBeat(beat)
          }
          onClick={() =>
            onShipBeat?.(
              getShipBeatPayload(beat, repo),
            )
          }
        >
          <Clapperboard className="size-3" />
          Take!
        </Button>
      )}
      <Button
        variant="outline"
        size="xs"
        title="Re-run scope refinement for this beat"
        disabled={refineDisabled}
        onClick={() => void handleRefineScope()}
      >
        <RefreshCw
          className={
            "size-3"
            + (isEnqueuing || isPending
              ? " animate-spin"
              : "")
          }
        />
        {isEnqueuing
          ? "Enqueuing\u2026"
          : isPending
            ? "Refinement pending"
            : "Refine Scope"}
      </Button>
      <MoveToProjectDialog
        beat={beat}
        currentRepo={repo}
        onMoved={onMoved}
      />
    </div>
  );
}
