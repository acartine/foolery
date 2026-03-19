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

// ── Constants ──────────────────────────────────────────────────

const AUDIT_FILENAME = "lease-audit.jsonl";
const DEV_LOG_DIRNAME = ".foolery-logs";
const SIBLING_WORKTREE_PATTERN = /^(.*)-wt-[^\\/]+$/u;
const CLAUDE_WORKTREES_SEGMENT =
  /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/u;
const KNOTS_WORKTREE_SEGMENT =
  /^(.*?)[\\/]\.knots[\\/]_worktree(?:[\\/].*)?$/u;

// ── Path helpers ───────────────────────────────────────────────

function trimPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, "");
}

function auditFilePath(logRoot: string): string {
  return join(logRoot, AUDIT_FILENAME);
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
