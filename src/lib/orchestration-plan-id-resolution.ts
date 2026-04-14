import { basename } from "node:path";

import { listRepos } from "@/lib/registry";
import type { CreatePlanInput } from "@/lib/orchestration-plan-types";

function addUnique(
  values: string[],
  value: string | undefined,
): void {
  const trimmed = value?.trim();
  if (!trimmed || values.includes(trimmed)) return;
  values.push(trimmed);
}

export function canonicalizePlanId(
  planId: string,
  repoPath?: string,
): string {
  const trimmed = planId.trim();
  if (!trimmed || trimmed.includes("-")) return trimmed;
  const repoName = repoPath?.trim()
    ? basename(repoPath.trim())
    : "";
  return repoName ? `${repoName}-${trimmed}` : trimmed;
}

export function normalizeSelectedBeatIds(
  beatIds: string[],
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const beatId of beatIds) {
    const trimmed = beatId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function buildPlanTitle(
  input: CreatePlanInput,
): string {
  const repoLabel = basename(input.repoPath);
  const objective = input.objective?.trim();
  if (objective) {
    return `Execution plan: ${objective}`;
  }
  return `Execution plan for ${repoLabel}`;
}

export async function resolvePlanLookupRepos(
  planId: string,
  repoPath?: string,
): Promise<string[]> {
  const candidates: string[] = [];
  addUnique(candidates, repoPath);

  const registeredRepos = await listRepos();
  const repoPrefix = planId.includes("-")
    ? planId.split("-", 1)[0]
    : "";

  if (repoPrefix) {
    for (const repo of registeredRepos) {
      if (repo.name === repoPrefix) {
        addUnique(candidates, repo.path);
      }
    }
  }

  for (const repo of registeredRepos) {
    addUnique(candidates, repo.path);
  }

  return candidates;
}
