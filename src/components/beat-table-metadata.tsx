import type { Beat } from "@/lib/types";

export type MetadataEntry = Record<string, unknown>;
export type RenderedCapsule = {
  entry: MetadataEntry;
  key: string;
  content: string;
};

export const HANDOFF_METADATA_KEYS = [
  "knotsHandoffCapsules",
  "knots_handoff_capsules",
  "handoff_capsules",
  "handoffCapsules",
  "handoff_capsule_history",
] as const;

export function pickString(
  entry: MetadataEntry,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

export function pickObject(
  entry: MetadataEntry,
  keys: string[],
): MetadataEntry | null {
  for (const key of keys) {
    const value = entry[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      return value as MetadataEntry;
    }
  }
  return null;
}

function readMetadataEntries(
  beat: Beat,
  keys: string[],
): MetadataEntry[] {
  const metadata = beat.metadata;
  if (!metadata || typeof metadata !== "object") return [];

  for (const key of keys) {
    const raw = (metadata as Record<string, unknown>)[key];
    if (!Array.isArray(raw)) continue;
    return raw.filter(
      (entry): entry is MetadataEntry =>
        Boolean(entry && typeof entry === "object"),
    );
  }

  return [];
}

function metadataEntryKey(
  entry: MetadataEntry,
  index: number,
): string {
  return (
    pickString(
      entry,
      ["entry_id", "id", "step_id", "uuid"],
    ) ?? String(index)
  );
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function safeRelativeTime(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? value : relativeTime(value);
}

/**
 * Build display meta line for a handoff capsule.
 *
 * Knots stamps handoff capsules with a flat, canonical set of fields
 * (per ~/knots/docs/leases.md "What Knots stamps from the lease"):
 *   - `agentname`   (agent identity)
 *   - `model`       (agent model)
 *   - `version`     (agent model version)
 *   - `username`    (human user, when applicable)
 *
 * Per docs/knots-agent-identity-contract.md "Forbidden patterns" #4,
 * this reader uses ONE canonical key per concept — no multi-key
 * fallback chains, no nested `agent` object lookups. If a capsule is
 * missing a canonical field, the meta line simply omits it (the
 * absence of identity is itself information).
 */
export function capsuleMeta(
  entry: MetadataEntry,
): string | undefined {
  const agentName = pickString(entry, ["agentname"]);
  const model = pickString(entry, ["model"]);
  const version = pickString(entry, ["version"]);
  const username = pickString(entry, ["username"]);
  const datetime = resolveDatetime(entry);

  return (
    [agentName, model, version, username, datetime]
      .filter(Boolean)
      .join(" | ") || undefined
  );
}

function resolveDatetime(
  entry: MetadataEntry,
): string | undefined {
  // Datetime is not part of the agent-identity contract; capsules may
  // legitimately surface a few stamping conventions. Keep this tight:
  // a single canonical key plus its widely-used legacy aliases.
  const keys = [
    "datetime", "timestamp", "ts",
    "created_at", "createdAt",
    "updated_at", "updatedAt", "time",
  ];
  return safeRelativeTime(pickString(entry, keys));
}

export function renderedHandoffCapsules(
  beat: Beat,
): RenderedCapsule[] {
  return readMetadataEntries(
    beat,
    [...HANDOFF_METADATA_KEYS],
  )
    .flatMap((capsule, index) => {
      const content = pickString(capsule, [
        "content",
        "summary",
        "message",
        "description",
        "note",
      ]);
      if (!content) return [];
      return [{
        entry: capsule,
        key: metadataEntryKey(capsule, index),
        content,
      }];
    })
    .reverse();
}
