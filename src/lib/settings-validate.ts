/**
 * Shared helpers for validating a Foolery `settings.toml` file against
 * `foolerySettingsSchema`.
 *
 * Consumed by both the `foolery config validate` CLI (see
 * `src/bin/foolery-config.ts`) and the `settings-config-validate`
 * doctor check (see `src/lib/doctor-checks-settings-validate.ts`) so
 * both surfaces share one parse + format implementation.
 *
 * This module deliberately does not shell out to any external binary —
 * all validation happens in-process via `foolerySettingsSchema.safeParse`
 * so the doctor check works from source as well as from a bundled tarball.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import { z } from "zod/v4";

import { foolerySettingsSchema } from "./schemas";

export interface ValidateOk {
  kind: "ok";
  data: unknown;
}

export interface ValidateFileError {
  kind: "file-error";
  filePath: string;
  message: string;
}

export interface ValidateParseError {
  kind: "parse-error";
  filePath: string;
  message: string;
}

export interface ValidateSchemaError {
  kind: "schema-error";
  filePath: string;
  error: z.ZodError;
}

export type ValidateResult =
  | ValidateOk
  | ValidateFileError
  | ValidateParseError
  | ValidateSchemaError;

export function defaultSettingsPath(): string {
  return path.join(os.homedir(), ".config", "foolery", "settings.toml");
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatPath(issuePath: ReadonlyArray<PropertyKey>): string {
  if (issuePath.length === 0) return "(root)";
  return issuePath.map((p) => String(p)).join(".");
}

export function formatReceived(issue: z.core.$ZodIssue): string {
  if (!("input" in issue) || issue.input === undefined) return "";
  try {
    return ` (received: ${JSON.stringify(issue.input)})`;
  } catch {
    return ` (received: ${String(issue.input)})`;
  }
}

export function formatIssue(issue: z.core.$ZodIssue): string {
  return `${formatPath(issue.path)}: ${issue.message}${formatReceived(issue)}`;
}

export function formatIssues(error: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    lines.push(`  - ${formatIssue(issue)}`);
  }
  return lines.join("\n");
}

export function validateSettingsToml(filePath: string): ValidateResult {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      kind: "file-error",
      filePath,
      message: errMessage(err),
    };
  }

  let parsed: unknown;
  try {
    parsed = parseToml(contents);
  } catch (err) {
    return {
      kind: "parse-error",
      filePath,
      message: errMessage(err),
    };
  }

  const result = foolerySettingsSchema.safeParse(parsed);
  if (result.success) {
    return { kind: "ok", data: result.data };
  }
  return {
    kind: "schema-error",
    filePath,
    error: result.error,
  };
}
