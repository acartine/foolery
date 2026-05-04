import type { KnotRecord } from "@/lib/knots";
import * as knots from "@/lib/knots";

type ListLeases = (
  repoPath?: string,
  all?: boolean,
) => Promise<{
  ok: boolean;
  data?: KnotRecord[];
}>;

export async function leaseAcquiredAtByLeaseId(
  repoPath: string,
): Promise<ReadonlyMap<string, string>> {
  const listLeases = resolveListLeases();
  if (!listLeases) return new Map();

  const leases = await listLeases(repoPath, true);
  if (!leases.ok) {
    return leaseAcquiredAtByLeaseIdFromActiveLeases(
      repoPath,
      listLeases,
    );
  }
  return leaseAcquiredAtByLeaseIdFromRecords(leases.data ?? []);
}

async function leaseAcquiredAtByLeaseIdFromActiveLeases(
  repoPath: string,
  listLeases: ListLeases,
): Promise<ReadonlyMap<string, string>> {
  const leases = await listLeases(repoPath);
  if (!leases.ok) return new Map();
  return leaseAcquiredAtByLeaseIdFromRecords(leases.data ?? []);
}

function leaseAcquiredAtByLeaseIdFromRecords(
  leases: readonly KnotRecord[],
): ReadonlyMap<string, string> {
  const byLeaseId = new Map<string, string>();
  for (const lease of leases) {
    const leaseId = cleanString(lease.id);
    const acquiredAt = leaseAcquiredAt(lease);
    if (!leaseId || !acquiredAt) continue;
    byLeaseId.set(leaseId, acquiredAt);
  }
  return byLeaseId;
}

function resolveListLeases(): ListLeases | undefined {
  try {
    return (knots as unknown as { listLeases?: ListLeases }).listLeases;
  } catch {
    return undefined;
  }
}

export function leaseAcquiredAt(
  lease: KnotRecord,
): string | undefined {
  return stepStartedAt(lease, "lease_active")
    ?? cleanString(lease.created_at)
    ?? cleanString(lease.updated_at);
}

function stepStartedAt(
  lease: KnotRecord,
  targetStep: string,
): string | undefined {
  const entries = [
    ...(lease.step_history ?? []),
    ...(lease.stepHistory ?? []),
    ...(lease.steps ?? []),
  ];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.step !== targetStep) continue;
    const startedAt = cleanString(record.started_at);
    if (startedAt) return startedAt;
  }
  return undefined;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
