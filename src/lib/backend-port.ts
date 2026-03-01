/**
 * BackendPort - The core operations interface for beat management.
 *
 * Any backend implementation (CLI wrapper, HTTP client, in-memory store)
 * must satisfy this contract. All types are implementation-neutral and
 * contain no runtime code.
 */

import type {
  ActionOwnerKind,
  Beat,
  BeatDependency,
  BeatPriority,
  MemoryWorkflowDescriptor,
} from "./types";
import type { CreateBeatInput, UpdateBeatInput } from "./schemas";

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
 *
 * Uses optional fields (rather than a discriminated union) to match the
 * existing BdResult pattern and allow ergonomic access in test code that
 * asserts `ok` at runtime rather than narrowing at compile time.
 */
export interface BackendResult<T> {
  ok: boolean;
  data?: T;
  error?: BackendError;
}

// ── Request DTOs ────────────────────────────────────────────

/** Filters applied to list, listReady, and search operations. */
export interface BeatListFilters {
  type?: string;
  state?: string;
  workflowId?: string;
  priority?: BeatPriority;
  label?: string;
  assignee?: string;
  owner?: string;
  parent?: string;
  profileId?: string;
  requiresHumanAction?: boolean;
  nextOwnerKind?: ActionOwnerKind;
}

/** Options for query operations. */
export interface BeatQueryOptions {
  /** Maximum number of results to return. */
  limit?: number;
  /** Sort expression (backend-specific format). */
  sort?: string;
}

// ── BackendPort interface ───────────────────────────────────

/**
 * The main contract that any beat backend must implement.
 *
 * Every method returns a `BackendResult` to allow callers to handle
 * success and failure uniformly without exceptions.
 */
export interface BackendPort {
  /** List workflow descriptors exposed by this backend/repository. */
  listWorkflows(
    repoPath?: string,
  ): Promise<BackendResult<MemoryWorkflowDescriptor[]>>;

  /** List all beats, optionally filtered. */
  list(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>>;

  /** List beats that are ready to work on (unblocked). */
  listReady(
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>>;

  /** Full-text search across beats. */
  search(
    query: string,
    filters?: BeatListFilters,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>>;

  /** Execute an arbitrary query expression. */
  query(
    expression: string,
    options?: BeatQueryOptions,
    repoPath?: string,
  ): Promise<BackendResult<Beat[]>>;

  /** Retrieve a single beat by ID. */
  get(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<Beat>>;

  /** Create a new beat. Returns the assigned ID. */
  create(
    input: CreateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<{ id: string }>>;

  /** Update an existing beat's fields. */
  update(
    id: string,
    input: UpdateBeatInput,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** Permanently delete a beat. */
  delete(
    id: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** Close a beat with an optional reason. */
  close(
    id: string,
    reason?: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** List dependencies for a given beat. */
  listDependencies(
    id: string,
    repoPath?: string,
    options?: { type?: string },
  ): Promise<BackendResult<BeatDependency[]>>;

  /** Add a blocking dependency between two beats. */
  addDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;

  /** Remove a blocking dependency between two beats. */
  removeDependency(
    blockerId: string,
    blockedId: string,
    repoPath?: string,
  ): Promise<BackendResult<void>>;
}

// ── Re-exports ──────────────────────────────────────────────

export type { Beat, BeatDependency, BeatPriority } from "./types";
export type { MemoryWorkflowDescriptor } from "./types";
export type { CreateBeatInput, UpdateBeatInput } from "./schemas";

// ── Deprecated re-exports ───────────────────────────────────

/** @deprecated Use BeatListFilters */
export type BeadListFilters = BeatListFilters;
/** @deprecated Use BeatQueryOptions */
export type BeadQueryOptions = BeatQueryOptions;
