import type { BackendError } from "@/lib/backend-port";

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
