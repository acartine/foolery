/**
 * Doctor check: validate `~/.config/foolery/settings.toml` against
 * `foolerySettingsSchema`.
 *
 * The check surfaces every Zod issue as its own error-severity
 * diagnostic carrying the field path and received value — no generic
 * "config problem" coalescing — so users can locate the bad key
 * immediately. TOML parse errors surface as a single error diagnostic;
 * file-read errors surface as a warning (the `settings-defaults`
 * check already covers the file-missing case).
 */

import {
  defaultSettingsPath,
  formatIssue,
  validateSettingsToml,
  type ValidateResult,
} from "./settings-validate";
import type { Diagnostic } from "./doctor-types";

export const SETTINGS_VALIDATE_CHECK = "settings-config-validate";

function okDiagnostic(filePath: string): Diagnostic {
  return {
    check: SETTINGS_VALIDATE_CHECK,
    severity: "info",
    message: `Settings TOML validates against the schema (${filePath}).`,
    fixable: false,
  };
}

function fileErrorDiagnostic(
  filePath: string,
  message: string,
): Diagnostic {
  return {
    check: SETTINGS_VALIDATE_CHECK,
    severity: "warning",
    message:
      `Could not read settings file ${filePath} for schema validation: `
      + message,
    fixable: false,
  };
}

function parseErrorDiagnostic(
  filePath: string,
  message: string,
): Diagnostic {
  return {
    check: SETTINGS_VALIDATE_CHECK,
    severity: "error",
    message:
      `TOML parse error in ${filePath}: ${message}`,
    fixable: false,
  };
}

function toDiagnostics(result: ValidateResult): Diagnostic[] {
  switch (result.kind) {
    case "ok":
      // result has no filePath; use the caller-supplied one via closure.
      return [];
    case "file-error":
      return [fileErrorDiagnostic(result.filePath, result.message)];
    case "parse-error":
      return [parseErrorDiagnostic(result.filePath, result.message)];
    case "schema-error":
      return result.error.issues.map((issue) => ({
        check: SETTINGS_VALIDATE_CHECK,
        severity: "error" as const,
        message: `${result.filePath}: ${formatIssue(issue)}`,
        fixable: false,
        context: {
          filePath: result.filePath,
          zodPath: issue.path.map((p) => String(p)).join("."),
        },
      }));
  }
}

/**
 * Run the settings-config-validate check against the given path
 * (default: `~/.config/foolery/settings.toml`).
 *
 * Exposes `filePath` as an argument so tests can point at tempdir
 * fixtures without mutating the real `~/.config`.
 */
export async function checkSettingsValidate(
  filePath: string = defaultSettingsPath(),
): Promise<Diagnostic[]> {
  const result = validateSettingsToml(filePath);
  if (result.kind === "ok") {
    return [okDiagnostic(filePath)];
  }
  return toDiagnostics(result);
}
