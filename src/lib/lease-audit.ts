import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { resolveInteractionLogRoot } from "@/lib/interaction-logger";

// ── Types ──────────────────────────────────────────────────────

export interface LeaseAuditAgent {
  provider?: string;
  model?: string;
  flavor?: string;
  version?: string;
}

export interface LeaseAuditEvent {
  timestamp: string;
  beatId: string;
  sessionId: string;
  agent: LeaseAuditAgent;
  queueType: string;
  outcome: "claim" | "success" | "fail";
}

export interface LeaseAuditAggregate {
  agent: LeaseAuditAgent;
  queueType: string;
  outcome: "claim" | "success" | "fail";
  date: string;
  count: number;
}

export type LeaseLifecycleOutcome = "success" | "warning" | "error";

export interface LeaseLifecycleEvent {
  ts: string;
  event: string;
  repoPath?: string;
  repoSlug?: string;
  sessionId?: string;
  executionLeaseId?: string;
  knotsLeaseId?: string;
  beatId?: string;
  claimedId?: string;
  interactionType?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  outcome: LeaseLifecycleOutcome;
  message: string;
  data?: Record<string, unknown>;
}

export interface LogLeaseAuditInput {
  event: string;
  repoPath?: string;
  sessionId?: string;
  executionLeaseId?: string;
  knotsLeaseId?: string;
  beatId?: string;
  claimedId?: string;
  interactionType?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  outcome: LeaseLifecycleOutcome;
  message: string;
  data?: Record<string, unknown>;
}

// ── Constants ──────────────────────────────────────────────────

const AUDIT_FILENAME = "lease-audit.jsonl";
const LEASE_LIFECYCLE_FILENAME = "leases.jsonl";
export const LEASES_SLUG = "_leases";
const DEV_LOG_DIRNAME = ".foolery-logs";
const SIBLING_WORKTREE_PATTERN = /^(.*)-wt-[^\\/]+$/u;
const CLAUDE_WORKTREES_SEGMENT =
  /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/u;
const KNOTS_WORKTREE_SEGMENT =
  /^(.*?)[\\/]\.knots[\\/]_worktree(?:[\\/].*)?$/u;
const leaseLifecycleWriteQueue = new Map<string, Promise<void>>();

// ── Path helpers ───────────────────────────────────────────────

function trimPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, "");
}

function auditFilePath(logRoot: string): string {
  return join(logRoot, AUDIT_FILENAME);
}

function leaseLifecycleDirPath(logRoot: string, date: string): string {
  return join(logRoot, LEASES_SLUG, date);
}

function leaseLifecycleFilePath(logRoot: string, date: string): string {
  return join(leaseLifecycleDirPath(logRoot, date), LEASE_LIFECYCLE_FILENAME);
}

function repoSlugFor(repoPath?: string): string | undefined {
  if (!repoPath) return undefined;
  const trimmed = trimPathSeparators(repoPath.trim());
  if (!trimmed) return undefined;
  return basename(trimmed);
}

function enqueueWrite(filePath: string, task: () => Promise<void>): Promise<void> {
  const pending = leaseLifecycleWriteQueue.get(filePath) ?? Promise.resolve();
  const next = pending.catch(() => undefined).then(task);
  leaseLifecycleWriteQueue.set(filePath, next.finally(() => {
    if (leaseLifecycleWriteQueue.get(filePath) === next) {
      leaseLifecycleWriteQueue.delete(filePath);
    }
  }));
  return next;
}

// ── Worktree discovery (mirrors agent-history.ts) ──────────────

function inferCanonicalRepoPath(repoPath: string): string | null {
  const trimmed = trimPathSeparators(repoPath.trim());
  if (!trimmed) return null;

  const claudeMatch = trimmed.match(CLAUDE_WORKTREES_SEGMENT);
  if (claudeMatch?.[1]) return trimPathSeparators(claudeMatch[1]);

  const knotsMatch = trimmed.match(KNOTS_WORKTREE_SEGMENT);
  if (knotsMatch?.[1]) return trimPathSeparators(knotsMatch[1]);

  const baseName = basename(trimmed);
  const siblingMatch = baseName.match(SIBLING_WORKTREE_PATTERN);
  if (siblingMatch?.[1]) {
    return trimPathSeparators(join(dirname(trimmed), siblingMatch[1]));
  }

  return null;
}

async function listSubdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

async function discoverRelatedRepoPaths(repoPath: string): Promise<string[]> {
  const trimmed = trimPathSeparators(repoPath.trim());
  if (!trimmed) return [];

  const baseRoots = new Set<string>([trimmed]);
  const canonical = inferCanonicalRepoPath(trimmed);
  if (canonical) baseRoots.add(canonical);

  const related = new Set<string>(baseRoots);
  for (const baseRoot of baseRoots) {
    related.add(join(baseRoot, ".knots", "_worktree"));

    const siblingCandidates = await listSubdirectories(dirname(baseRoot));
    const siblingPrefix = `${basename(baseRoot)}-wt-`;
    for (const siblingPath of siblingCandidates) {
      if (basename(siblingPath).startsWith(siblingPrefix)) {
        related.add(trimPathSeparators(siblingPath));
      }
    }

    const claudeWorktrees = await listSubdirectories(
      join(baseRoot, ".claude", "worktrees"),
    );
    for (const wt of claudeWorktrees) {
      related.add(trimPathSeparators(wt));
    }
  }

  return Array.from(related.values());
}

// ── Log root resolution ────────────────────────────────────────

export async function resolveAuditLogRoots(
  repoPath?: string,
): Promise<string[]> {
  const roots = new Set<string>([resolveInteractionLogRoot()]);

  if (repoPath) {
    const relatedPaths = await discoverRelatedRepoPaths(repoPath);
    for (const rp of relatedPaths) {
      const devRoot = join(rp, DEV_LOG_DIRNAME);
      roots.add(devRoot);
    }
  }

  return Array.from(roots.values());
}

export function resolveLeaseAuditDir(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return leaseLifecycleDirPath(resolveInteractionLogRoot(), day);
}

export async function logLeaseAudit(input: LogLeaseAuditInput): Promise<void> {
  const ts = new Date().toISOString();
  const date = ts.slice(0, 10);
  const logRoot = resolveInteractionLogRoot();
  const dirPath = leaseLifecycleDirPath(logRoot, date);
  const filePath = leaseLifecycleFilePath(logRoot, date);
  const payload: LeaseLifecycleEvent = {
    ts,
    event: input.event,
    repoPath: input.repoPath,
    repoSlug: repoSlugFor(input.repoPath),
    sessionId: input.sessionId,
    executionLeaseId: input.executionLeaseId,
    knotsLeaseId: input.knotsLeaseId,
    beatId: input.beatId,
    claimedId: input.claimedId,
    interactionType: input.interactionType,
    agentName: input.agentName,
    agentModel: input.agentModel,
    agentVersion: input.agentVersion,
    outcome: input.outcome,
    message: input.message,
    data: input.data,
  };

  await enqueueWrite(filePath, async () => {
    await mkdir(dirPath, { recursive: true });
    await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
  });
}

// ── Append ─────────────────────────────────────────────────────

export async function appendLeaseAuditEvent(
  event: LeaseAuditEvent,
): Promise<void> {
  const logRoot = resolveInteractionLogRoot();
  await mkdir(logRoot, { recursive: true });
  const filePath = auditFilePath(logRoot);
  const line = JSON.stringify(event) + "\n";
  await appendFile(filePath, line, "utf-8");
}

// ── Read ───────────────────────────────────────────────────────

function parseEventLine(line: string): LeaseAuditEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      typeof parsed.timestamp !== "string" ||
      typeof parsed.beatId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.queueType !== "string" ||
      !parsed.agent ||
      typeof parsed.agent !== "object"
    ) {
      return null;
    }
    const outcome = parsed.outcome;
    if (outcome !== "claim" && outcome !== "success" && outcome !== "fail") {
      return null;
    }
    return parsed as unknown as LeaseAuditEvent;
  } catch {
    return null;
  }
}

async function readEventsFromRoot(logRoot: string): Promise<LeaseAuditEvent[]> {
  const filePath = auditFilePath(logRoot);
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const events: LeaseAuditEvent[] = [];
  for (const line of content.split("\n")) {
    const event = parseEventLine(line);
    if (event) events.push(event);
  }
  return events;
}

export async function readLeaseAuditEvents(
  roots?: string[],
): Promise<LeaseAuditEvent[]> {
  const effectiveRoots = roots ?? (await resolveAuditLogRoots());
  const results = await Promise.all(effectiveRoots.map(readEventsFromRoot));
  return results.flat();
}

// ── Aggregation ────────────────────────────────────────────────

function agentKey(agent: LeaseAuditAgent): string {
  return [
    agent.provider ?? "",
    agent.model ?? "",
    agent.flavor ?? "",
    agent.version ?? "",
  ].join("|");
}

export function aggregateLeaseAudit(
  events: LeaseAuditEvent[],
): LeaseAuditAggregate[] {
  const map = new Map<
    string,
    { agent: LeaseAuditAgent; queueType: string; outcome: "claim" | "success" | "fail"; date: string; count: number }
  >();

  for (const event of events) {
    const date = event.timestamp.slice(0, 10); // YYYY-MM-DD
    const key = `${agentKey(event.agent)}::${event.queueType}::${event.outcome}::${date}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        agent: { ...event.agent },
        queueType: event.queueType,
        outcome: event.outcome,
        date,
        count: 1,
      });
    }
  }

  return Array.from(map.values());
}

// ── Retrospective attribution ──────────────────────────────────

export async function markBeatShipped(beatId: string): Promise<void> {
  const events = await readLeaseAuditEvents();
  const claims = events.filter(
    (e) => e.beatId === beatId && e.outcome === "claim",
  );
  if (claims.length === 0) return;

  // Group claims by queueType, find last claimant per queue
  const lastClaimByQueue = new Map<string, LeaseAuditEvent>();
  for (const claim of claims) {
    const existing = lastClaimByQueue.get(claim.queueType);
    if (!existing || claim.timestamp >= existing.timestamp) {
      lastClaimByQueue.set(claim.queueType, claim);
    }
  }

  const now = new Date().toISOString();

  for (const claim of claims) {
    const lastClaim = lastClaimByQueue.get(claim.queueType)!;
    const isSuccess =
      agentKey(claim.agent) === agentKey(lastClaim.agent) &&
      claim.timestamp === lastClaim.timestamp;

    await appendLeaseAuditEvent({
      timestamp: now,
      beatId: claim.beatId,
      sessionId: claim.sessionId,
      agent: { ...claim.agent },
      queueType: claim.queueType,
      outcome: isSuccess ? "success" : "fail",
    });
  }
}
