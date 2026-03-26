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

/** Build display meta line for a handoff capsule. */
export function capsuleMeta(
  entry: MetadataEntry,
): string | undefined {
  const metadata = pickObject(
    entry,
    ["metadata", "meta", "details"],
  );
  const agent =
    pickObject(entry, ["agent", "executor", "worker"]) ??
    (metadata
      ? pickObject(
        metadata,
        ["agent", "executor", "worker"],
      )
      : null);
  const user =
    pickObject(
      entry,
      ["user", "author", "created_by", "createdBy"],
    ) ??
    (metadata
      ? pickObject(
        metadata,
        ["user", "author", "created_by", "createdBy"],
      )
      : null);
  const actor =
    pickObject(
      entry,
      ["actor", "updated_by", "updatedBy", "by"],
    ) ??
    (metadata
      ? pickObject(
        metadata,
        ["actor", "updated_by", "updatedBy", "by"],
      )
      : null);

  const agentName = resolveAgentName(
    entry,
    metadata,
    agent,
  );
  const model = resolveModel(entry, metadata, agent);
  const version = resolveVersion(entry, metadata, agent);
  const username = resolveUsername(
    entry,
    metadata,
    user,
    actor,
  );
  const datetime = resolveDatetime(entry, metadata);

  return (
    [agentName, model, version, username, datetime]
      .filter(Boolean)
      .join(" | ") || undefined
  );
}

function resolveAgentName(
  entry: MetadataEntry,
  metadata: MetadataEntry | null,
  agent: MetadataEntry | null,
): string | undefined {
  const keys = ["agentname", "agentName", "agent_name"];
  return (
    pickString(entry, keys) ??
    (metadata ? pickString(metadata, keys) : undefined) ??
    (agent
      ? pickString(
        agent,
        ["name", ...keys],
      )
      : undefined)
  );
}

function resolveModel(
  entry: MetadataEntry,
  metadata: MetadataEntry | null,
  agent: MetadataEntry | null,
): string | undefined {
  const keys = ["model", "agentModel", "agent_model"];
  return (
    pickString(entry, keys) ??
    (metadata ? pickString(metadata, keys) : undefined) ??
    (agent ? pickString(agent, keys) : undefined)
  );
}

function resolveVersion(
  entry: MetadataEntry,
  metadata: MetadataEntry | null,
  agent: MetadataEntry | null,
): string | undefined {
  const keys = [
    "version",
    "agentVersion",
    "agent_version",
  ];
  return (
    pickString(entry, keys) ??
    (metadata ? pickString(metadata, keys) : undefined) ??
    (agent ? pickString(agent, keys) : undefined)
  );
}

function resolveUsername(
  entry: MetadataEntry,
  metadata: MetadataEntry | null,
  user: MetadataEntry | null,
  actor: MetadataEntry | null,
): string | undefined {
  const entryKeys = [
    "username", "user", "user_name",
    "actor", "actor_name",
  ];
  const nameKeys = ["name", "username", "login"];
  return (
    pickString(entry, entryKeys) ??
    (metadata
      ? pickString(metadata, entryKeys)
      : undefined) ??
    (user ? pickString(user, nameKeys) : undefined) ??
    (actor ? pickString(actor, nameKeys) : undefined)
  );
}

function resolveDatetime(
  entry: MetadataEntry,
  metadata: MetadataEntry | null,
): string | undefined {
  const entryKeys = [
    "datetime", "timestamp", "ts",
    "created_at", "createdAt",
    "updated_at", "updatedAt", "time",
  ];
  const metaKeys = [
    ...entryKeys, "at", "occurred_at",
  ];
  return safeRelativeTime(
    pickString(entry, entryKeys) ??
      (metadata
        ? pickString(metadata, metaKeys)
        : undefined),
  );
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
