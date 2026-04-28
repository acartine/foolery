import { NextResponse } from "next/server";
import type { BackendError } from "@/lib/backend-port";
import {
  DISPATCH_FAILURE_MARKER,
  DispatchFailureError,
} from "@/lib/dispatch-pool-resolver";

/**
 * Convert a `DispatchFailureError` into a 500 JSON response. Used by API
 * route handlers that wrap backend calls; the body includes the red banner
 * text so the UI can surface it directly.
 */
export function dispatchFailureToResponse(
  err: DispatchFailureError,
): NextResponse {
  return NextResponse.json(
    {
      error: err.message,
      banner: err.banner,
      marker: DISPATCH_FAILURE_MARKER,
    },
    { status: 500 },
  );
}

/**
 * Wrap an async API route handler so that any `DispatchFailureError` thrown
 * while resolving a backend is converted into a structured 500 response.
 * Other errors propagate unchanged.
 */
export async function withDispatchFailureHandling<T>(
  handler: () => Promise<T | NextResponse>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof DispatchFailureError) {
      return dispatchFailureToResponse(err);
    }
    throw err;
  }
}

export function backendErrorStatus(error: BackendError | undefined): number {
  if (!error) return 500;

  switch (error.code) {
    case "NOT_FOUND":
      return 404;
    case "ALREADY_EXISTS":
    case "CONFLICT":
      return 409;
    case "INVALID_INPUT":
      return 400;
    case "PERMISSION_DENIED":
      return 403;
    case "LOCKED":
      return 423;
    case "TIMEOUT":
      return 504;
    case "UNAVAILABLE":
      return 503;
    case "RATE_LIMITED":
      return 429;
    case "UNSUPPORTED":
      return 405;
    case "INTERNAL":
    default:
      return 500;
  }
}
