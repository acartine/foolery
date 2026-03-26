/**
 * Shared type definitions for the doctor subsystem.
 *
 * Extracted to avoid circular dependencies between
 * doctor.ts, doctor-fixes.ts, and doctor-checks.ts.
 */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface FixOption {
  key: string;
  label: string;
}

export interface Diagnostic {
  check: string;
  severity: DiagnosticSeverity;
  message: string;
  fixable: boolean;
  /** Available fix strategies when fixable is true */
  fixOptions?: FixOption[];
  /** Context for auto-fix */
  context?: Record<string, string>;
}

export interface FixResult {
  check: string;
  success: boolean;
  message: string;
  context?: Record<string, string>;
}

export interface DoctorReport {
  timestamp: string;
  diagnostics: Diagnostic[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    fixable: number;
  };
}

export interface DoctorFixReport {
  timestamp: string;
  fixes: FixResult[];
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
}

// ── Streaming types ─────────────────────────────────────

export type DoctorCheckStatus =
  | "pass"
  | "fail"
  | "warning";

export interface DoctorCheckResult {
  done?: false;
  category: string;
  label: string;
  status: DoctorCheckStatus;
  summary: string;
  diagnostics: Diagnostic[];
}

export interface DoctorStreamSummary {
  done: true;
  passed: number;
  failed: number;
  warned: number;
  fixable: number;
}

export type DoctorStreamEvent =
  | DoctorCheckResult
  | DoctorStreamSummary;

// ── Fix strategy types ──────────────────────────────────

export type FixStrategyEntry =
  | string
  | {
    strategy: string;
    contexts?: Record<string, string>[];
  };

export type FixStrategies =
  Record<string, FixStrategyEntry>;
