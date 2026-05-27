import type { KnotRecord } from "@/lib/knots";
import {
  extractAcceptanceFromNotes,
} from "@/lib/backends/knots-backend-helpers";

export type KnotLeaseAgentInfo = {
  agent_type?: string;
  provider?: string;
  agent_name?: string;
  model?: string;
  model_version?: string;
};

export type KnotLeaseMetadata = {
  agentInfo?: KnotLeaseAgentInfo;
  leaseId?: string;
  acquiredAt?: string;
};

export function extractAcceptance(
  knot: KnotRecord,
): string | undefined {
  const nativeAcceptance =
    typeof knot.acceptance === "string"
      ? knot.acceptance.trim() || undefined
      : undefined;
  return nativeAcceptance ?? extractAcceptanceFromNotes(knot.notes);
}

export function extractVerificationSteps(
  knot: KnotRecord,
): string[] {
  if (!Array.isArray(knot.verification_steps)) return [];
  return knot.verification_steps.flatMap((step) => {
    if (typeof step !== "string") return [];
    const normalized = step.trim();
    return normalized ? [normalized] : [];
  });
}

export function knotLeaseMetadata(
  knot: KnotRecord,
  leaseAcquiredAtById: ReadonlyMap<string, string>,
): KnotLeaseMetadata {
  const leaseId = cleanString(knot.lease_id);
  const acquiredAt = leaseId
    ? cleanString(leaseAcquiredAtById.get(leaseId))
    : undefined;
  return {
    agentInfo: knotLeaseAgentInfo(knot),
    leaseId,
    acquiredAt,
  };
}

function knotLeaseAgentInfo(
  knot: KnotRecord,
): KnotLeaseAgentInfo | undefined {
  return cleanLeaseAgentInfo(knot.lease?.agent_info)
    ?? cleanLeaseAgentInfo(
      (knot as KnotRecord & { lease_agent?: unknown }).lease_agent,
    );
}

function cleanLeaseAgentInfo(
  value: unknown,
): KnotLeaseAgentInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const info: KnotLeaseAgentInfo = {};
  copyAgentField(info, record, "agent_type");
  copyAgentField(info, record, "provider");
  copyAgentField(info, record, "agent_name");
  copyAgentField(info, record, "model");
  copyAgentField(info, record, "model_version");
  return Object.keys(info).length > 0 ? info : undefined;
}

function copyAgentField(
  info: KnotLeaseAgentInfo,
  record: Record<string, unknown>,
  key: keyof KnotLeaseAgentInfo,
): void {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) {
    info[key] = value.trim();
  }
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
