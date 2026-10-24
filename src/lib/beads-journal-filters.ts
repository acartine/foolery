/** Preserve the CLI's workflow filtering and delegate native complex filters. */
import type { BeatListFilters } from "./backend-port";
import type { Beat } from "./types";
import { applyWorkflowFilters } from "./bd-queries";

export function filterJournalBeats(beats: Beat[], filters?: BeatListFilters): Beat[] | undefined {
  const values = Object.fromEntries(Object.entries(filters ?? {}).filter(([, value]) =>
    value !== undefined && value !== null).map(([key, value]) => [key, String(value)]));
  // CLI state selection has workspace-defined done/frozen/pinned exclusions;
  // parent/label/assignee selectors also have native semantics. Keep those on
  // the CLI path, triggered by change notices instead of a snapshot timer.
  const keys = new Set(["type", "priority", "workflowId", "profileId",
    "requiresHumanAction", "nextOwnerKind"]);
  if (Object.keys(values).some((key) => !keys.has(key))) return undefined;
  // Explicit internal types can override bd's default type suppression and may
  // not occur in the ordinary --all snapshot.
  if (values.type && !["bug", "feature", "task", "epic", "chore"].includes(values.type)) {
    return undefined;
  }
  if (values.priority !== undefined && !/^[0-4]$/.test(values.priority)) return undefined;
  // Journal snapshots omit the storage-plane bit. A promoted durable issue can
  // retain ephemeral/no_history flags, so let the CLI resolve ambiguous planes.
  if (beats.some((beat) => {
    const raw = beat as Beat & { ephemeral?: boolean; no_history?: boolean };
    return raw.ephemeral || raw.no_history;
  })) return undefined;
  // --all widens statuses, not visibility. Journal records also include
  // templates, gates, infrastructure, and the ephemeral plane hidden by list.
  const native = beats.filter((beat) => {
    const raw = beat as Beat & { is_template?: boolean };
    return !raw.is_template
      && !["gate", "agent", "role", "message"].includes(beat.type);
  }).filter((beat) => (!values.type || beat.type === values.type)
    && (values.priority === undefined || String(beat.priority) === values.priority));
  return applyWorkflowFilters(native, values);
}
