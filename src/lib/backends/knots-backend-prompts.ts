/**
 * Take/Poll prompt builders and dependency operations for KnotsBackend.
 * Extracted from knots-backend.ts to stay within the 500-line limit.
 */

import type {
  BackendResult,
  PollPromptOptions,
  PollPromptResult,
  TakePromptOptions,
  TakePromptResult,
} from "@/lib/backend-port";
import type { BeatDependency } from "@/lib/types";
import type { KnotEdge } from "@/lib/knots";
import * as knots from "@/lib/knots";

import {
  ok,
  propagateError,
  fromKnots,
  collectAliases,
} from "@/lib/backends/knots-backend-helpers";

// ── Dependency operations ───────────────────────────────────────────

export async function listDependenciesImpl(
  id: string,
  rp: string,
  getEdgesForId: (
    id: string,
    rp: string,
  ) => Promise<BackendResult<KnotEdge[]>>,
  options?: { type?: string },
): Promise<BackendResult<BeatDependency[]>> {
  const showResult = fromKnots(
    await knots.showKnot(id, rp),
  );
  if (!showResult.ok) {
    return propagateError<BeatDependency[]>(showResult);
  }

  const edgesResult = await getEdgesForId(id, rp);
  if (!edgesResult.ok) {
    return propagateError<BeatDependency[]>(edgesResult);
  }

  const aliasCache = new Map<
    string,
    string[] | undefined
  >();
  const loadAliases = async (
    beatId: string,
  ): Promise<string[] | undefined> => {
    if (aliasCache.has(beatId))
      return aliasCache.get(beatId);
    const knotResult =
      beatId === id
        ? showResult
        : fromKnots(await knots.showKnot(beatId, rp));
    const collected =
      knotResult.ok && knotResult.data
        ? collectAliases(knotResult.data)
        : [];
    const aliases =
      collected.length > 0 ? collected : undefined;
    aliasCache.set(beatId, aliases);
    return aliases;
  };

  const deps = await buildDepsFromEdges(
    id,
    edgesResult.data ?? [],
    options,
    loadAliases,
  );

  const uniqueLinkedIds = [
    ...new Set(deps.map((d) => d.id)),
  ];
  const aliasMap = new Map<string, string[]>();
  await Promise.allSettled(
    uniqueLinkedIds.map(async (linkedId) => {
      const linkedKnot = fromKnots(
        await knots.showKnot(linkedId, rp),
      );
      if (linkedKnot.ok && linkedKnot.data) {
        const a = collectAliases(linkedKnot.data);
        if (a.length) aliasMap.set(linkedId, a);
      }
    }),
  );
  for (const dep of deps) {
    const linkedAliases = aliasMap.get(dep.id);
    if (linkedAliases?.length) dep.aliases = linkedAliases;
  }

  return ok(deps);
}

async function buildDepsFromEdges(
  id: string,
  edges: KnotEdge[],
  options: { type?: string } | undefined,
  loadAliases: (
    beatId: string,
  ) => Promise<string[] | undefined>,
): Promise<BeatDependency[]> {
  const deps: BeatDependency[] = [];
  for (const edge of edges) {
    if (edge.kind === "blocked_by") {
      if (options?.type && options.type !== "blocks")
        continue;
      const blockerId = edge.dst;
      const blockedId = edge.src;
      if (id !== blockerId && id !== blockedId) continue;
      const linkedId =
        id === blockerId ? blockedId : blockerId;

      deps.push({
        id: linkedId,
        aliases: await loadAliases(linkedId),
        type: "blocks",
        source: blockerId,
        target: blockedId,
        dependency_type: "blocked_by",
      });
    }

    if (edge.kind === "parent_of") {
      const parentId = edge.src;
      const childId = edge.dst;
      if (id !== parentId && id !== childId) continue;
      const linkedId =
        id === parentId ? childId : parentId;

      deps.push({
        id: linkedId,
        aliases: await loadAliases(linkedId),
        type: "parent-child",
        source: parentId,
        target: childId,
        dependency_type: "parent_of",
      });
    }
  }
  return deps;
}

export async function addDependencyImpl(
  blockerId: string,
  blockedId: string,
  rp: string,
  invalidateEdgeCache: (rp: string, id?: string) => void,
): Promise<BackendResult<void>> {
  const blockerExists = fromKnots(
    await knots.showKnot(blockerId, rp),
  );
  if (!blockerExists.ok) {
    return propagateError<void>(blockerExists);
  }

  const blockedExists = fromKnots(
    await knots.showKnot(blockedId, rp),
  );
  if (!blockedExists.ok) {
    return propagateError<void>(blockedExists);
  }

  const addResult = fromKnots(
    await knots.addEdge(
      blockedId,
      "blocked_by",
      blockerId,
      rp,
    ),
  );
  if (!addResult.ok) {
    return propagateError<void>(addResult);
  }

  invalidateEdgeCache(rp, blockerId);
  invalidateEdgeCache(rp, blockedId);
  return { ok: true };
}

export async function removeDependencyImpl(
  blockerId: string,
  blockedId: string,
  rp: string,
  invalidateEdgeCache: (rp: string, id?: string) => void,
): Promise<BackendResult<void>> {
  const removeResult = fromKnots(
    await knots.removeEdge(
      blockedId,
      "blocked_by",
      blockerId,
      rp,
    ),
  );
  if (!removeResult.ok) {
    return propagateError<void>(removeResult);
  }

  invalidateEdgeCache(rp, blockerId);
  invalidateEdgeCache(rp, blockedId);
  return { ok: true };
}

// ── Take prompt builders ────────────────────────────────────────────

export async function buildParentTakePrompt(
  beatId: string,
  options: TakePromptOptions,
  rp: string,
): Promise<BackendResult<TakePromptResult>> {
  const parentResult = fromKnots(
    await knots.showKnot(beatId, rp),
  );
  if (!parentResult.ok) {
    return propagateError<TakePromptResult>(parentResult);
  }
  const parent = parentResult.data!;

  const childLines = (options.childBeatIds ?? []).map(
    (id) =>
      `- Child ${id}: run \`kno claim ` +
      `${JSON.stringify(id)} --json\`` +
      `, use the returned \`prompt\` only for that ` +
      `claimed step` +
      `, run only the completion command from that ` +
      `claim output` +
      `, then check \`kno show ` +
      `${JSON.stringify(id)} --json\`.`,
  );
  const prompt = [
    `Parent beat ID: ${beatId}`,
    parent.title ? `Title: ${parent.title}` : null,
    parent.description
      ? `Description: ${parent.description}`
      : parent.body
        ? `Description: ${parent.body}`
        : null,
    ``,
    `Open child beat IDs:`,
    ...(options.childBeatIds ?? []).map(
      (id) => `- ${id}`,
    ),
    ``,
    `KNOTS CLAIM MODE (required):`,
    `Always claim a knot before implementation and ` +
      `treat each claim result as a single-step ` +
      `authorization.`,
    `If \`kno claim\` exits with a non-zero code, ` +
      `stop immediately \u2014 do not proceed without ` +
      `claim constraints.`,
    ...childLines,
    `- Each child claim authorizes exactly one ` +
      `workflow action. After its completion command ` +
      `succeeds, stop work on that child for this ` +
      `session.`,
    `- Do not immediately re-claim the same child ` +
      `after a successful completion unless a later ` +
      `Foolery prompt explicitly tells you to do so.`,
    `- Do not try to drive a child all the way to ` +
      `\`shipped\` unless the claim output for the ` +
      `current step explicitly makes that the allowed ` +
      `exit state.`,
    `- If a child is left in an active state (for ` +
      `example \`implementation_review\`), run ` +
      `\`kno next <id> --expected-state <currentState>` +
      ` --actor-kind agent\` once to return it to ` +
      `queue, then stop work on that child.`,
    `- Do not guess or brute-force workflow ` +
      `transitions outside the claim output.`,
    `- If \`kno claim\` exits with a non-zero exit ` +
      `code for a child, stop work on that child ` +
      `immediately. Do not attempt further work ` +
      `without a valid claim.`,
    `- Ignore generic instructions about finishing ` +
      `the whole knot, shipping, or pushing unless ` +
      `the active child claim explicitly requires ` +
      `them.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return ok({ prompt, claimed: false });
}

export async function buildSingleTakePrompt(
  beatId: string,
  options: TakePromptOptions | undefined,
  rp: string,
): Promise<BackendResult<TakePromptResult>> {
  const showResult = fromKnots(
    await knots.showKnot(beatId, rp),
  );
  if (!showResult.ok) {
    return propagateError<TakePromptResult>(showResult);
  }
  const knot = showResult.data!;

  if (!options?.knotsLeaseId) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `knotsLeaseId is required to build ` +
          `a take prompt for ${beatId}`,
        retryable: false,
      },
    };
  }
  const claimCmd =
    `kno claim "${beatId}" --json ` +
    `--lease "${options.knotsLeaseId}"`;
  console.log(
    `[knots-backend-prompts] buildSingleTakePrompt: ` +
    `beatId=${beatId} ` +
    `leaseId=${options.knotsLeaseId} ` +
    `claimCmd=${claimCmd}`,
  );

  const prompt = [
    `Beat ID: ${beatId}`,
    knot.title ? `Title: ${knot.title}` : null,
    knot.description
      ? `Description: ${knot.description}`
      : knot.body
        ? `Description: ${knot.body}`
        : null,
    ``,
    `KNOTS CLAIM MODE (required):`,
    `Run \`${claimCmd}\` and use the returned ` +
      `\`prompt\` only for the currently claimed step.`,
    `Treat that claim result as a single-step ` +
      `authorization: run only the completion command ` +
      `from the claim output, then stop immediately.`,
    `Do not run \`kno claim\` again in this session ` +
      `after the completion command succeeds.`,
    `Do not inspect, review, or advance later ` +
      `workflow states on your own.`,
    `Ignore generic instructions about finishing the ` +
      `whole knot, shipping, or pushing unless the ` +
      `active claim explicitly requires them.`,
    `If \`kno claim\` exits with a non-zero exit ` +
      `code, you MUST stop immediately \u2014 do not ` +
      `attempt to work without a valid claim. ` +
      `Simply exit.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return ok({ prompt, claimed: false });
}

// ── Poll prompt ─────────────────────────────────────────────────────

export async function buildPollPromptImpl(
  rp: string,
  options?: PollPromptOptions,
): Promise<BackendResult<PollPromptResult>> {
  const pollResult = fromKnots(
    await knots.pollKnot(rp, {
      agentName: options?.agentName,
      agentModel: options?.agentModel,
      agentVersion: options?.agentVersion,
    }),
  );
  if (!pollResult.ok) {
    return propagateError<PollPromptResult>(pollResult);
  }

  return ok({
    prompt: pollResult.data!.prompt,
    claimedId: pollResult.data!.id,
  });
}
