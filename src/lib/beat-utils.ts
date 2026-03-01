import type { Beat } from "./types";
import type { CreateBeatInput } from "./schemas";

/**
 * Extract the fields from a Beat that should be copied when moving
 * to another project. Excludes parent (project-scoped IDs),
 * id, timestamps, owner, state, and metadata.
 */
export function beatToCreateInput(beat: Beat): CreateBeatInput {
  return {
    title: beat.title,
    description: beat.description,
    type: beat.type,
    priority: beat.priority,
    labels: [...beat.labels],
    assignee: beat.assignee,
    due: beat.due,
    acceptance: beat.acceptance,
    notes: beat.notes,
    estimate: beat.estimate,
  };
}
