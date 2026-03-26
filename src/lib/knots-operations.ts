/**
 * Knot mutation operations: create, claim, update, transition,
 * edges, leases, and polling.
 *
 * Extracted from knots.ts to stay within the 500-line limit.
 */
import type { BdResult } from "./types";
import type {
  KnotRecord,
  KnotClaimPrompt,
  KnotEdge,
  KnotUpdateInput,
} from "./knots";
import {
  _exec as exec,
  _execWrite as execWrite,
  _execWriteWithRetry as execWriteWithRetry,
  _withNextKnotSerialization as withNextKnotSerialization,
  _parseJson as parseJson,
} from "./knots";

function fail(stderr: string, label: string): BdResult<never> {
  return { ok: false, error: stderr || `knots ${label} failed` };
}

function parseOrFail<T>(
  stdout: string,
  label: string,
): BdResult<T> {
  try {
    return { ok: true, data: parseJson<T>(stdout) };
  } catch {
    return { ok: false, error: `Failed to parse knots ${label} output` };
  }
}

// ── Create ───────────────────────────────────────────────────

export async function newKnot(
  title: string,
  options?: {
    description?: string;
    body?: string;
    acceptance?: string;
    state?: string;
    profile?: string;
    workflow?: string;
  },
  repoPath?: string,
): Promise<BdResult<{ id: string }>> {
  const args = ["new"];
  const description = options?.description ?? options?.body;
  if (description) args.push(`--desc=${description}`);
  if (options?.acceptance !== undefined) {
    args.push(`--acceptance=${options.acceptance}`);
  }
  if (options?.state) args.push("--state", options.state);

  const selectedProfile = options?.profile ?? options?.workflow;
  if (selectedProfile) args.push("--profile", selectedProfile);

  args.push("--", title);

  const { stdout, stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return fail(stderr, "new");
  const match = /^created\s+(\S+)/m.exec(stdout);
  if (!match?.[1]) {
    return {
      ok: false,
      error: "Failed to parse knots new output",
    };
  }
  return { ok: true, data: { id: match[1] } };
}

// ── Claim ────────────────────────────────────────────────────

export interface ClaimKnotOptions {
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  leaseId?: string;
}

export async function claimKnot(
  id: string,
  repoPath?: string,
  options?: ClaimKnotOptions,
): Promise<BdResult<KnotClaimPrompt>> {
  const args = ["claim", id, "--json"];
  if (options?.agentName) {
    args.push("--agent-name", options.agentName);
  }
  if (options?.agentModel) {
    args.push("--agent-model", options.agentModel);
  }
  if (options?.agentVersion) {
    args.push("--agent-version", options.agentVersion);
  }
  if (options?.leaseId) args.push("--lease", options.leaseId);
  const { stdout, stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return fail(stderr, "claim");
  return parseOrFail<KnotClaimPrompt>(stdout, "claim");
}

// ── Skill prompt ─────────────────────────────────────────────

export async function skillPrompt(
  stateOrId: string,
  repoPath?: string,
): Promise<BdResult<string>> {
  const { stdout, stderr, exitCode } = await exec(["skill", stateOrId], { repoPath });
  if (exitCode !== 0) return fail(stderr, "skill");
  return { ok: true, data: stdout };
}

// ── Next (transition) ────────────────────────────────────────

export interface NextKnotOptions {
  actorKind?: string;
  expectedState?: string;
  leaseId?: string;
}

export async function nextKnot(
  id: string,
  repoPath?: string,
  options?: NextKnotOptions,
): Promise<BdResult<void>> {
  return withNextKnotSerialization(id, async () => {
    const args = ["next", id];
    if (options?.expectedState) {
      args.push("--expected-state", options.expectedState);
    }
    if (options?.actorKind) {
      args.push("--actor-kind", options.actorKind);
    }
    if (options?.leaseId) {
      args.push("--lease", options.leaseId);
    }
    const { stderr, exitCode } = await execWriteWithRetry(args, { repoPath });
    if (exitCode !== 0) return fail(stderr, "next");
    return { ok: true };
  });
}

// ── Profile set ──────────────────────────────────────────────

export interface SetKnotProfileOptions {
  state?: string;
  ifMatch?: string;
}

export async function setKnotProfile(
  id: string,
  profile: string,
  repoPath?: string,
  options?: SetKnotProfileOptions,
): Promise<BdResult<void>> {
  const args = ["profile", "set", id, profile];
  if (options?.state) args.push("--state", options.state);
  if (options?.ifMatch) args.push("--if-match", options.ifMatch);
  const { stderr, exitCode } = await execWriteWithRetry(args, { repoPath });
  if (exitCode !== 0) return fail(stderr, "profile set");
  return { ok: true };
}

// ── Poll ─────────────────────────────────────────────────────

export interface PollKnotOptions {
  stage?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
}

export async function pollKnot(
  repoPath?: string,
  options?: PollKnotOptions,
): Promise<BdResult<KnotClaimPrompt>> {
  const args = ["poll", "--claim", "--json"];
  if (options?.stage) args.push(options.stage);
  if (options?.agentName) {
    args.push("--agent-name", options.agentName);
  }
  if (options?.agentModel) {
    args.push("--agent-model", options.agentModel);
  }
  if (options?.agentVersion) args.push("--agent-version", options.agentVersion);
  const { stdout, stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return fail(stderr, "poll --claim");
  return parseOrFail<KnotClaimPrompt>(stdout, "poll");
}

// ── Update ───────────────────────────────────────────────────

export async function updateKnot(
  id: string,
  input: KnotUpdateInput,
  repoPath?: string,
): Promise<BdResult<void>> {
  const args = ["update", id];

  if (input.title !== undefined) {
    args.push(`--title=${input.title}`);
  }
  if (input.description !== undefined) {
    args.push(`--description=${input.description}`);
  }
  if (input.acceptance !== undefined) {
    args.push(`--acceptance=${input.acceptance}`);
  }
  if (input.priority !== undefined) {
    args.push("--priority", String(input.priority));
  }
  if (input.status !== undefined) {
    args.push("--status", input.status);
  }
  if (input.type !== undefined) {
    args.push("--type", input.type);
  }

  for (const tag of input.addTags ?? []) {
    if (tag.trim()) args.push(`--add-tag=${tag}`);
  }
  for (const tag of input.removeTags ?? []) {
    if (tag.trim()) args.push(`--remove-tag=${tag}`);
  }

  appendNoteArgs(args, input);
  appendHandoffArgs(args, input);
  appendInvariantArgs(args, input);

  if (input.force) args.push("--force");

  const { stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return fail(stderr, "update");
  return { ok: true };
}

function appendNoteArgs(
  args: string[],
  input: KnotUpdateInput,
): void {
  if (input.addNote === undefined) return;
  args.push(`--add-note=${input.addNote}`);
  args.push(
    "--note-username",
    input.noteUsername || "foolery",
  );
  if (input.noteDatetime) {
    args.push("--note-datetime", input.noteDatetime);
  }
  args.push(
    "--note-agentname",
    input.noteAgentname || "foolery",
  );
  if (input.noteModel) {
    args.push("--note-model", input.noteModel);
  }
  if (input.noteVersion) {
    args.push("--note-version", input.noteVersion);
  }
}

function appendHandoffArgs(
  args: string[],
  input: KnotUpdateInput,
): void {
  if (input.addHandoffCapsule === undefined) return;
  args.push(
    `--add-handoff-capsule=${input.addHandoffCapsule}`,
  );
  args.push(
    "--handoff-username",
    input.handoffUsername || "foolery",
  );
  if (input.handoffDatetime) {
    args.push("--handoff-datetime", input.handoffDatetime);
  }
  args.push(
    "--handoff-agentname",
    input.handoffAgentname || "foolery",
  );
  if (input.handoffModel) {
    args.push("--handoff-model", input.handoffModel);
  }
  if (input.handoffVersion) {
    args.push("--handoff-version", input.handoffVersion);
  }
}

function appendInvariantArgs(
  args: string[],
  input: KnotUpdateInput,
): void {
  for (const inv of input.addInvariants ?? []) {
    const normalized = inv.trim();
    if (normalized) {
      args.push(`--add-invariant=${normalized}`);
    }
  }
  for (const inv of input.removeInvariants ?? []) {
    const normalized = inv.trim();
    if (normalized) {
      args.push(`--remove-invariant=${normalized}`);
    }
  }
  if (input.clearInvariants) {
    args.push("--clear-invariants");
  }
}

// ── Edges ────────────────────────────────────────────────────

export async function listEdges(
  id: string,
  direction: "incoming" | "outgoing" | "both" = "both",
  repoPath?: string,
): Promise<BdResult<KnotEdge[]>> {
  const { stdout, stderr, exitCode } = await exec(
    ["edge", "list", id, "--direction", direction, "--json"],
    { repoPath },
  );
  if (exitCode !== 0) return fail(stderr, "edge list");
  return parseOrFail<KnotEdge[]>(stdout, "edge list");
}

export async function addEdge(
  src: string,
  kind: string,
  dst: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await execWrite(["edge", "add", src, kind, dst], { repoPath });
  if (exitCode !== 0) return fail(stderr, "edge add");
  return { ok: true };
}

export async function removeEdge(
  src: string,
  kind: string,
  dst: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await execWrite(["edge", "remove", src, kind, dst], { repoPath });
  if (exitCode !== 0) return fail(stderr, "edge remove");
  return { ok: true };
}

// ── Leases ───────────────────────────────────────────────────

export interface CreateLeaseOptions {
  nickname: string;
  type?: "agent" | "manual";
  agentName?: string;
  model?: string;
  modelVersion?: string;
  provider?: string;
  agentType?: string;
}

export async function createLease(
  options: CreateLeaseOptions,
  repoPath?: string,
): Promise<BdResult<KnotRecord>> {
  const args = [
    "lease",
    "create",
    "--nickname",
    options.nickname,
  ];
  if (options.type) args.push("--type", options.type);
  if (options.agentName) {
    args.push("--agent-name", options.agentName);
  }
  if (options.model) args.push("--model", options.model);
  if (options.modelVersion) {
    args.push("--model-version", options.modelVersion);
  }
  if (options.provider) {
    args.push("--provider", options.provider);
  }
  if (options.agentType) {
    args.push("--agent-type", options.agentType);
  }
  args.push("--json");
  const { stdout, stderr, exitCode } = await execWrite(args, { repoPath });
  if (exitCode !== 0) return fail(stderr, "lease create");
  return parseOrFail<KnotRecord>(stdout, "lease create");
}

export async function terminateLease(
  id: string,
  repoPath?: string,
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await execWrite(["lease", "terminate", id], { repoPath });
  if (exitCode !== 0) return fail(stderr, "lease terminate");
  return { ok: true };
}

export async function listLeases(
  repoPath?: string,
  all?: boolean,
): Promise<BdResult<KnotRecord[]>> {
  const args = ["lease", "list", "--json"];
  if (all) args.push("--all");
  const { stdout, stderr, exitCode } = await exec(args, { repoPath });
  if (exitCode !== 0) return fail(stderr, "lease list");
  return parseOrFail<KnotRecord[]>(stdout, "lease list");
}
