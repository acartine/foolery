import { describe, expect, it } from "vitest";

import {
  BackendError,
  alreadyExists,
  classifyErrorMessage,
  conflict,
  internal,
  invalidInput,
  isRetryableByDefault,
  isSuppressible,
  locked,
  notFound,
  permissionDenied,
  rateLimited,
  timeout,
  unavailable,
} from "../backend-errors";
import type { BackendErrorCode } from "../backend-errors";

// ── BackendError construction ─────────────────────────────

describe("BackendError", () => {
  it("stores code, message, and default retryable flag", () => {
    const err = new BackendError("NOT_FOUND", "gone");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("gone");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("BackendError");
  });

  it("allows overriding retryable", () => {
    const err = new BackendError("INTERNAL", "oops", { retryable: true });
    expect(err.retryable).toBe(true);
  });

  it("accepts optional details", () => {
    const details = { field: "name", reason: "too short" };
    const err = new BackendError("INVALID_INPUT", "bad", { details });
    expect(err.details).toEqual(details);
  });

  it("accepts optional cause", () => {
    const cause = new Error("root");
    const err = new BackendError("INTERNAL", "wrapper", { cause });
    expect(err.cause).toBe(cause);
  });

  it("has no cause when none is provided", () => {
    const err = new BackendError("INTERNAL", "standalone");
    expect(err.cause).toBeUndefined();
  });

  it("extends Error for proper stack traces", () => {
    const err = new BackendError("TIMEOUT", "slow");
    expect(err).toBeInstanceOf(Error);
    expect(err.stack).toBeDefined();
  });

  it("details is undefined when not provided", () => {
    const err = new BackendError("LOCKED", "busy");
    expect(err.details).toBeUndefined();
  });
});

// ── Default retryability ──────────────────────────────────

describe("isRetryableByDefault", () => {
  const retryableCodes: BackendErrorCode[] = [
    "LOCKED",
    "TIMEOUT",
    "UNAVAILABLE",
    "RATE_LIMITED",
  ];

  const nonRetryableCodes: BackendErrorCode[] = [
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "INVALID_INPUT",
    "PERMISSION_DENIED",
    "INTERNAL",
    "CONFLICT",
  ];

  it.each(retryableCodes)("%s is retryable by default", (code) => {
    expect(isRetryableByDefault(code)).toBe(true);
  });

  it.each(nonRetryableCodes)("%s is not retryable by default", (code) => {
    expect(isRetryableByDefault(code)).toBe(false);
  });
});

// ── Factory functions ─────────────────────────────────────

describe("factory functions", () => {
  it("notFound creates NOT_FOUND error with id in message", () => {
    const err = notFound("bead-42");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toContain("bead-42");
    expect(err.retryable).toBe(false);
  });

  it("alreadyExists creates ALREADY_EXISTS error with id in message", () => {
    const err = alreadyExists("bead-42");
    expect(err.code).toBe("ALREADY_EXISTS");
    expect(err.message).toContain("bead-42");
    expect(err.retryable).toBe(false);
  });

  it("invalidInput creates INVALID_INPUT error with details", () => {
    const details = { field: "title" };
    const err = invalidInput("title is required", details);
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.message).toBe("title is required");
    expect(err.details).toEqual(details);
    expect(err.retryable).toBe(false);
  });

  it("invalidInput works without details", () => {
    const err = invalidInput("bad input");
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.details).toBeUndefined();
  });

  it("locked creates LOCKED error with default message", () => {
    const err = locked();
    expect(err.code).toBe("LOCKED");
    expect(err.message).toBe("Resource is locked");
    expect(err.retryable).toBe(true);
  });

  it("locked accepts a custom message", () => {
    const err = locked("database is locked");
    expect(err.message).toBe("database is locked");
  });

  it("timeout creates TIMEOUT error with default message", () => {
    const err = timeout();
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toBe("Operation timed out");
    expect(err.retryable).toBe(true);
  });

  it("timeout accepts a custom message", () => {
    const err = timeout("query took too long");
    expect(err.message).toBe("query took too long");
  });

  it("unavailable creates UNAVAILABLE error with default message", () => {
    const err = unavailable();
    expect(err.code).toBe("UNAVAILABLE");
    expect(err.message).toBe("Backend is unavailable");
    expect(err.retryable).toBe(true);
  });

  it("unavailable accepts a custom message", () => {
    const err = unavailable("bd not configured");
    expect(err.message).toBe("bd not configured");
  });

  it("permissionDenied creates PERMISSION_DENIED error", () => {
    const err = permissionDenied();
    expect(err.code).toBe("PERMISSION_DENIED");
    expect(err.message).toBe("Permission denied");
    expect(err.retryable).toBe(false);
  });

  it("permissionDenied accepts a custom message", () => {
    const err = permissionDenied("EACCES on /repo");
    expect(err.message).toBe("EACCES on /repo");
  });

  it("internal creates INTERNAL error with cause", () => {
    const cause = new TypeError("null ref");
    const err = internal("unexpected failure", cause);
    expect(err.code).toBe("INTERNAL");
    expect(err.message).toBe("unexpected failure");
    expect(err.cause).toBe(cause);
    expect(err.retryable).toBe(false);
  });

  it("internal works without cause", () => {
    const err = internal("oops");
    expect(err.cause).toBeUndefined();
  });

  it("conflict creates CONFLICT error", () => {
    const err = conflict("concurrent edit");
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("concurrent edit");
    expect(err.retryable).toBe(false);
  });

  it("rateLimited creates RATE_LIMITED error with default message", () => {
    const err = rateLimited();
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toBe("Too many requests");
    expect(err.retryable).toBe(true);
  });

  it("rateLimited accepts a custom message", () => {
    const err = rateLimited("slow down");
    expect(err.message).toBe("slow down");
  });
});

// ── classifyErrorMessage ──────────────────────────────────

describe("classifyErrorMessage", () => {
  it.each([
    ["resource not found", "NOT_FOUND"],
    ["no such file or directory", "NOT_FOUND"],
    ["bead does not exist", "NOT_FOUND"],
    ["bead already exists", "ALREADY_EXISTS"],
    ["duplicate key error", "ALREADY_EXISTS"],
    ["database is locked", "LOCKED"],
    ["could not obtain lock on repo", "LOCKED"],
    ["resource locked by another process", "LOCKED"],
    ["bd command timed out after 30s", "TIMEOUT"],
    ["connection timed out", "TIMEOUT"],
    ["operation timeout", "TIMEOUT"],
    ["EACCES: permission denied", "PERMISSION_DENIED"],
    ["unauthorized access", "PERMISSION_DENIED"],
    ["permission denied on /repo", "PERMISSION_DENIED"],
    ["server busy", "UNAVAILABLE"],
    ["service unavailable", "UNAVAILABLE"],
    ["unable to open database", "UNAVAILABLE"],
  ] as const)(
    "classifies %j as %s",
    (raw, expected) => {
      expect(classifyErrorMessage(raw)).toBe(expected);
    },
  );

  it("falls back to INTERNAL for unrecognised messages", () => {
    expect(classifyErrorMessage("something completely different")).toBe(
      "INTERNAL",
    );
  });

  it("is case-insensitive", () => {
    expect(classifyErrorMessage("NOT FOUND")).toBe("NOT_FOUND");
    expect(classifyErrorMessage("DATABASE IS LOCKED")).toBe("LOCKED");
    expect(classifyErrorMessage("Permission Denied")).toBe("PERMISSION_DENIED");
  });
});

// ── isSuppressible ────────────────────────────────────────

describe("isSuppressible", () => {
  const suppressibleCodes: BackendErrorCode[] = [
    "LOCKED",
    "TIMEOUT",
    "UNAVAILABLE",
    "RATE_LIMITED",
  ];

  const nonSuppressibleCodes: BackendErrorCode[] = [
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "INVALID_INPUT",
    "PERMISSION_DENIED",
    "INTERNAL",
    "CONFLICT",
  ];

  it.each(suppressibleCodes)("%s is suppressible", (code) => {
    const err = new BackendError(code, "test");
    expect(isSuppressible(err)).toBe(true);
  });

  it.each(nonSuppressibleCodes)("%s is not suppressible", (code) => {
    const err = new BackendError(code, "test");
    expect(isSuppressible(err)).toBe(false);
  });
});
