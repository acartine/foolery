/**
 * Backend error taxonomy and retry semantics.
 *
 * Standardises error codes, retryability rules, and classification helpers
 * so callers get structured errors instead of raw CLI strings.
 */

// ── Error codes ───────────────────────────────────────────

export type BackendErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "INVALID_INPUT"
  | "LOCKED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "INTERNAL"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNSUPPORTED";

// ── Default retryability ──────────────────────────────────

const DEFAULT_RETRYABLE: Record<BackendErrorCode, boolean> = {
  NOT_FOUND: false,
  ALREADY_EXISTS: false,
  INVALID_INPUT: false,
  LOCKED: true,
  TIMEOUT: true,
  UNAVAILABLE: true,
  PERMISSION_DENIED: false,
  INTERNAL: false,
  CONFLICT: false,
  RATE_LIMITED: true,
  UNSUPPORTED: false,
};

/** Returns the default retryability for the given error code. */
export function isRetryableByDefault(code: BackendErrorCode): boolean {
  return DEFAULT_RETRYABLE[code];
}

// ── BackendError class ────────────────────────────────────

export interface BackendErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BackendErrorCode,
    message: string,
    options?: BackendErrorOptions,
  ) {
    super(message, options?.cause != null ? { cause: options.cause } : undefined);
    this.name = "BackendError";
    this.code = code;
    this.retryable = options?.retryable ?? DEFAULT_RETRYABLE[code];
    this.details = options?.details;
  }
}

// ── Factory helpers ───────────────────────────────────────

export function notFound(id: string): BackendError {
  return new BackendError("NOT_FOUND", `Resource not found: ${id}`);
}

export function alreadyExists(id: string): BackendError {
  return new BackendError("ALREADY_EXISTS", `Resource already exists: ${id}`);
}

export function invalidInput(
  message: string,
  details?: Record<string, unknown>,
): BackendError {
  return new BackendError("INVALID_INPUT", message, { details });
}

export function locked(message?: string): BackendError {
  return new BackendError("LOCKED", message ?? "Resource is locked");
}

export function timeout(message?: string): BackendError {
  return new BackendError("TIMEOUT", message ?? "Operation timed out");
}

export function unavailable(message?: string): BackendError {
  return new BackendError(
    "UNAVAILABLE",
    message ?? "Backend is unavailable",
  );
}

export function permissionDenied(message?: string): BackendError {
  return new BackendError(
    "PERMISSION_DENIED",
    message ?? "Permission denied",
  );
}

export function internal(message: string, cause?: unknown): BackendError {
  return new BackendError("INTERNAL", message, { cause });
}

export function conflict(message: string): BackendError {
  return new BackendError("CONFLICT", message);
}

export function rateLimited(message?: string): BackendError {
  return new BackendError(
    "RATE_LIMITED",
    message ?? "Too many requests",
  );
}

// ── Raw string classification ─────────────────────────────

interface ClassificationRule {
  patterns: string[];
  code: BackendErrorCode;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  { patterns: ["not found", "no such", "does not exist"], code: "NOT_FOUND" },
  { patterns: ["already exists", "duplicate"], code: "ALREADY_EXISTS" },
  { patterns: ["lock", "locked", "database is locked"], code: "LOCKED" },
  { patterns: ["timed out", "timeout"], code: "TIMEOUT" },
  { patterns: ["permission denied", "unauthorized", "eacces"], code: "PERMISSION_DENIED" },
  { patterns: ["busy", "unavailable", "unable to open"], code: "UNAVAILABLE" },
];

/**
 * Maps a raw error string from a backend CLI to a BackendErrorCode.
 *
 * Pattern matching is case-insensitive. If no rule matches the string
 * is classified as INTERNAL.
 */
export function classifyErrorMessage(raw: string): BackendErrorCode {
  const lower = raw.toLowerCase();
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.patterns.some((p) => lower.includes(p))) {
      return rule.code;
    }
  }
  return "INTERNAL";
}

// ── Suppressibility check ─────────────────────────────────

const SUPPRESSIBLE_CODES: ReadonlySet<BackendErrorCode> = new Set<BackendErrorCode>([
  "LOCKED",
  "TIMEOUT",
  "UNAVAILABLE",
  "RATE_LIMITED",
]);

/**
 * Returns true if the error is the kind the error-suppression layer
 * should handle (transient infrastructure issues that resolve on their own).
 */
export function isSuppressible(error: BackendError): boolean {
  return SUPPRESSIBLE_CODES.has(error.code);
}
