import type { Bead } from "./types";
import type { CreateBeadInput } from "./schemas";

/**
 * Extract the fields from a Bead that should be copied when moving
 * to another project. Excludes parent (project-scoped IDs),
 * id, timestamps, owner, status, and metadata.
 */
export function beadToCreateInput(bead: Bead): CreateBeadInput {
  return {
    title: bead.title,
    description: bead.description,
    type: bead.type,
    priority: bead.priority,
    labels: [...bead.labels],
    assignee: bead.assignee,
    due: bead.due,
    acceptance: bead.acceptance,
    notes: bead.notes,
    estimate: bead.estimate,
  };
}
