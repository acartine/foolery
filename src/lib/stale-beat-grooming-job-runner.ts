import { getBackend } from "@/lib/backend-instance";
import { staleBeatAgeDays } from "@/lib/stale-beat-grooming";
import {
  resolveStaleBeatGroomingAgent,
} from "@/lib/stale-beat-grooming-agent";
import {
  buildStaleBeatGroomingPrompt,
  parseStaleBeatGroomingOutput,
} from "@/lib/stale-beat-grooming-prompt";
import {
  recordStaleBeatGroomingCompleted,
  recordStaleBeatGroomingFailed,
  recordStaleBeatGroomingRunning,
} from "@/lib/stale-beat-grooming-store";
import {
  runScopeRefinementPrompt,
} from "@/lib/scope-refinement-prompt";
import type {
  StaleBeatGroomingJob,
} from "@/lib/stale-beat-grooming-queue";
import type {
  StaleBeatGroomingResult,
} from "@/lib/stale-beat-grooming-types";
import type { Beat } from "@/lib/types";

export interface StaleBeatGroomingJobOutcome {
  ok: boolean;
  result?: StaleBeatGroomingResult;
  error?: string;
}

export async function processStaleBeatGroomingJob(
  job: StaleBeatGroomingJob,
): Promise<StaleBeatGroomingJobOutcome> {
  const target = {
    beatId: job.beatId,
    ...(job.repoPath ? { repoPath: job.repoPath } : {}),
  };
  recordStaleBeatGroomingRunning(target);
  try {
    const beat = await loadBeat(job);
    const agent = await resolveStaleBeatGroomingAgent({
      agentId: job.agentId,
    });
    const prompt = buildStaleBeatGroomingPrompt({
      beat,
      ageDays: staleBeatAgeDays(beat, Date.now()) ?? 0,
    });
    const raw = await runScopeRefinementPrompt(
      prompt,
      job.repoPath,
      agent,
    );
    const result = parseStaleBeatGroomingOutput(raw);
    if (!result) {
      throw new Error("agent returned unparseable grooming output");
    }
    recordStaleBeatGroomingCompleted(target, result);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);
    recordStaleBeatGroomingFailed(target, message);
    return { ok: false, error: message };
  }
}

async function loadBeat(
  job: StaleBeatGroomingJob,
): Promise<Beat> {
  const result = await getBackend().get(
    job.beatId,
    job.repoPath,
  );
  if (!result.ok || !result.data) {
    const detail = result.error instanceof Error
      ? result.error.message
      : result.error ?? "unknown";
    throw new Error(`failed to load beat: ${detail}`);
  }
  return result.data;
}
