/**
 * Public facade for bd CLI operations.
 *
 * Implementation is split across:
 *   bd-internal.ts   — exec plumbing, locking, retry
 *   bd-queries.ts    — list, show, search, query
 *   bd-mutations.ts  — create, delete, close, deps
 *   bd-update.ts     — updateBeat with label reconciliation
 */

export {
  listWorkflows,
  listBeats,
  readyBeats,
  searchBeats,
  queryBeats,
  showBeat,
} from "./bd-queries";

export {
  createBeat,
  deleteBeat,
  closeBeat,
  listDeps,
  addDep,
  removeDep,
} from "./bd-mutations";

export { updateBeat } from "./bd-update";

// ── Deprecated re-exports (to be removed in cleanup pass) ───
