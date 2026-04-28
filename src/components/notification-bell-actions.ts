import { fetchBeat } from "@/lib/api";
import {
  buildBeatFocusHref,
  resolveBeatRepoPath,
} from "@/lib/beat-navigation";
import type { Beat, RegisteredRepo } from "@/lib/types";
import { StepPhase, builtinProfileDescriptor } from "@/lib/workflows";
import { workflowStatePhase } from "@/lib/workflows-runtime";

interface MarkAllNotificationsReadAndCloseArgs {
  markAllRead: () => void;
  closeLightbox: () => void;
}

interface BuildNotificationBeatFocusHrefArgs {
  beat: Pick<Beat, "id" | "state" | "profileId" | "workflowId">;
  currentSearch: string;
  repoPath?: string | null;
}

interface FocusNotificationBeatArgs {
  beatId: string;
  currentSearch: string;
  registeredRepos: readonly RegisteredRepo[];
  explicitRepoPath?: string | null;
  setActiveRepo: (repoPath: string) => void;
  navigate: (href: string) => void;
  fetchBeatById?: typeof fetchBeat;
  logError?: (message?: unknown, ...optionalParams: unknown[]) => void;
}

export const NOTIFICATION_BEAT_FOCUS_FAILURE_MARKER =
  "FOOLERY NOTIFICATION BEAT FOCUS FAILURE";

export function markAllNotificationsReadAndClose({
  markAllRead,
  closeLightbox,
}: MarkAllNotificationsReadAndCloseArgs): void {
  markAllRead();
  closeLightbox();
}

export function buildNotificationBeatFocusHref({
  beat,
  currentSearch,
  repoPath,
}: BuildNotificationBeatFocusHrefArgs): string {
  const workflow = builtinProfileDescriptor(
    beat.profileId ?? beat.workflowId,
  );
  const phase = workflowStatePhase(workflow, beat.state);
  if (phase === StepPhase.Queued) {
    return buildBeatFocusHrefForView(
      beat.id,
      currentSearch,
      "queues",
      repoPath,
    );
  }
  if (phase === StepPhase.Active) {
    return buildBeatFocusHrefForView(
      beat.id,
      currentSearch,
      "active",
      repoPath,
    );
  }

  throw new Error(
    `${NOTIFICATION_BEAT_FOCUS_FAILURE_MARKER}: cannot focus beat `
      + `${beat.id} from notification because state=${beat.state} `
      + `resolves to phase=${phase ?? "<null>"}`,
  );
}

export async function focusNotificationBeat({
  beatId,
  currentSearch,
  registeredRepos,
  explicitRepoPath,
  setActiveRepo,
  navigate,
  fetchBeatById = fetchBeat,
  logError = console.error,
}: FocusNotificationBeatArgs): Promise<void> {
  const normalizedBeatId = beatId.trim();
  if (!normalizedBeatId) return;

  const repoPath = resolveBeatRepoPath(
    normalizedBeatId,
    registeredRepos,
    explicitRepoPath,
  );
  const result = await fetchBeatById(
    normalizedBeatId,
    repoPath ?? undefined,
  );
  if (!result.ok || !result.data) {
    logError(
      `${NOTIFICATION_BEAT_FOCUS_FAILURE_MARKER}: failed to fetch beat `
        + `${normalizedBeatId}${repoPath ? ` repo=${repoPath}` : ""}: `
        + `${result.error ?? "missing beat data"}`,
    );
    return;
  }

  try {
    const href = buildNotificationBeatFocusHref({
      beat: result.data,
      currentSearch,
      repoPath,
    });
    if (repoPath) setActiveRepo(repoPath);
    navigate(href);
  } catch (error) {
    if (error instanceof Error) {
      logError(error.message);
      return;
    }
    throw error;
  }
}

function buildBeatFocusHrefForView(
  beatId: string,
  currentSearch: string,
  view: "queues" | "active",
  repoPath?: string | null,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("view", view);
  return buildBeatFocusHref(
    beatId,
    params.toString(),
    repoPath ? { repo: repoPath, detailRepo: repoPath } : undefined,
  );
}
