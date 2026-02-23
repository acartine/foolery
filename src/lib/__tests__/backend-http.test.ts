import { describe, expect, it } from "vitest";
import { backendErrorStatus } from "@/lib/backend-http";
import type { BackendError } from "@/lib/backend-port";

function makeError(code: string): BackendError {
  return {
    code,
    message: `error:${code}`,
    retryable: false,
  };
}

describe("backendErrorStatus", () => {
  it("maps INVALID_INPUT to 400", () => {
    expect(backendErrorStatus(makeError("INVALID_INPUT"))).toBe(400);
  });

  it("maps NOT_FOUND to 404", () => {
    expect(backendErrorStatus(makeError("NOT_FOUND"))).toBe(404);
  });

  it("maps UNAVAILABLE to 503", () => {
    expect(backendErrorStatus(makeError("UNAVAILABLE"))).toBe(503);
  });

  it("defaults to 500 for unknown codes", () => {
    expect(backendErrorStatus(makeError("UNKNOWN"))).toBe(500);
  });
});
