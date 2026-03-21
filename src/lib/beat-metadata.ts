import type { Beat } from "@/lib/types";

export type MetadataEntry = Record<string, unknown>;

export const STEP_METADATA_KEYS = [
  "knotsSteps",
  "knots_steps",
  "knotsStepHistory",
  "knotsTimeline",
  "knotsTransitions",
  "stepHistory",
  "steps",
  "step_history",
  "timeline",
  "transitions",
] as const;

export const NOTE_METADATA_KEYS = [
  "knotsNotes",
  "knots_notes",
  "notes",
  "noteHistory",
  "note_history",
] as const;

export const HANDOFF_METADATA_KEYS = [
  "knotsHandoffCapsules",
  "knots_handoff_capsules",
  "handoff_capsules",
  "handoffCapsules",
  "handoff_capsule_history",
] as const;

export function pickString(entry: MetadataEntry, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function readMetadataEntries(beat: Beat, keys: readonly string[]): MetadataEntry[] {
  const metadata = beat.metadata;
  if (!metadata || typeof metadata !== "object") return [];

  for (const key of keys) {
    const raw = (metadata as Record<string, unknown>)[key];
    if (!Array.isArray(raw)) continue;
    return raw.filter((entry): entry is MetadataEntry => Boolean(entry && typeof entry === "object"));
  }

  return [];
}

export function readMetadataString(beat: Beat, keys: readonly string[]): string | undefined {
  const metadata = beat.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return pickString(metadata as MetadataEntry, keys);
}

export function metadataEntryKey(entry: MetadataEntry, index: number): string {
  return pickString(entry, ["entry_id", "id", "step_id", "uuid"]) ?? String(index);
}

export function pickObject(entry: MetadataEntry, keys: readonly string[]): MetadataEntry | null {
  for (const key of keys) {
    const value = entry[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as MetadataEntry;
    }
  }
  return null;
}

export function stepSummary(entry: MetadataEntry): string | undefined {
  const direct = pickString(entry, [
    "content",
    "summary",
    "description",
    "message",
    "note",
    "title",
    "details",
    "reason",
  ]);
  const from = pickString(entry, ["from_state", "fromState", "from", "prev_state", "previous_state"]);
  const to = pickString(entry, ["to_state", "toState", "to", "state", "next_state"]);
  const action = pickString(entry, ["action", "step", "event", "transition"]);
  const actorKind = pickString(entry, ["actor_kind", "actorKind", "owner_kind", "ownerKind"]);

  const parts: string[] = [];
  if (action) parts.push(action);
  if (from || to) parts.push(`${from ?? "?"} -> ${to ?? "?"}`);
  if (actorKind) parts.push(`actor:${actorKind}`);

  if (direct && parts.length === 0) return direct;
  if (!direct && parts.length === 0) return undefined;
  return direct ? `${direct}\n${parts.join(" · ")}` : parts.join(" · ");
}

function defaultRelativeTime(value: string): string {
  const now = Date.now();
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return value;
  const diff = now - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

export function safeRelativeTime(
  value: string,
  formatter: (value: string) => string = defaultRelativeTime,
): string {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? value : formatter(value);
}
