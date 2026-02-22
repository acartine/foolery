/**
 * BackendPort - The core operations interface for bead management.
 *
 * Any backend implementation (CLI wrapper, HTTP client, in-memory store)
 * must satisfy this contract. All types are implementation-neutral and
 * contain no runtime code.
 */

import type { Bead, BeadDependency, BeadPriority, BeadStatus, BeadType } from "./types";
import type { CreateBeadInput, UpdateBeadInput } from "./schemas";

// ── Structured error ────────────────────────────────────────

/**
 * Minimal structured error type. A richer taxonomy will be provided
 * by backend-errors.ts and integrated later.
 */
export interface BackendError {
  /** Machine-readable error code (e.g. "NOT_FOUND", "PARSE_ERROR"). */
  code: string;
  /** Human-readable error description. */
  message: string;
  /** Whether the caller can safely retry the operation. */
  retryable: boolean;
}

// ── Result envelope ─────────────────────────────────────────

/**
 * Enhanced result envelope replacing BdResult. Carries either a typed
 * data payload on success or a structured BackendError on failure.
 */
export type BackendResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BackendError };

// ── Request DTOs ────────────────────────────────────────────

/** Filters applied to list, listReady, and search operations. */
export interface BeadListFilters {
  type?: BeadType;
  status?: BeadStatus;
  priority?: BeadPriority;
  label?: string;
  assignee?: string;
  owner?: string;
  parent?: string;
}

/** Options for query operations. */
export interface BeadQueryOptions {
  /** Maximum number of results to return. */
  limit?: number;
  /** Sort expression (backend-specific format). */
  sort?: string;
}

// ── BackendPort interface ───────────────────────────────────

/**
 * The main contract that any bead backend must implement.
 *
 * Every method returns a `BackendResult` to allow callers to handle
 * success and failure uniformly without exceptions.
 */
export interface BackendPort {
  /** List all beads, optionally filtered. */
  list(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>>;

  /** List beads that are ready to work on (unblocked). */
  listReady(
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>>;

  /** Full-text search across beads. */
  search(
    query: string,
    filters?: BeadListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>>;

  /** Execute an arbitrary query expression. */
  query(
    expression: string,
    options?: BeadQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Bead[]>>;

  /** Retrieve a single bead by ID. */
  get(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<Bead>>;

  /** Create a new bead. Returns the assigned ID. */
  create(
    input: CreateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>>;

  /** Update an existing bead's fields. */
  update(
    id: string,
    input: UpdateBeadInput,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** Permanently delete a bead. */
  delete(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** Close a bead with an optional reason. */
  close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** List dependencies for a given bead. */
  listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeadDependency[]>>;

  /** Add a blocking dependency between two beads. */
  addDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** Remove a blocking dependency between two beads. */
  removeDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;
}

// ── Re-exports ──────────────────────────────────────────────

export type { Bead, BeadDependency, BeadType, BeadStatus, BeadPriority } from "./types";
export type { CreateBeadInput, UpdateBeadInput } from "./schemas";
