#!/usr/bin/env node
/**
 * foolery-config — schema introspection and config validation CLI.
 *
 * Subcommands:
 *   schema            Print the JSON Schema (Draft 2020-12) of
 *                     foolerySettingsSchema to stdout.
 *   validate [path]   Validate a TOML file against foolerySettingsSchema.
 *                     Defaults to ~/.config/foolery/settings.toml.
 *   help              Show usage.
 *
 * Exit codes:
 *   0  success (schema printed, or validate OK)
 *   1  schema validation failed
 *   2  usage error, file read error, or TOML parse error
 *
 * Consumed by the installed `foolery` launcher and by external agents
 * (Claude, Codex, OpenCode, etc.) so this CLI is the public, stable
 * interface to the settings spec — treat its behavior as contract.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import { z } from "zod/v4";

import { foolerySettingsSchema } from "../lib/schemas";

const USAGE
  = "Usage: foolery config <schema|validate|help> [args]\n"
  + "\n"
  + "  schema               Print the settings JSON Schema to stdout.\n"
  + "  validate [path]      Validate a TOML file against the schema.\n"
  + "                       Default path: ~/.config/foolery/settings.toml.\n"
  + "  help, --help, -h     Show this help.\n";

function printUsage(stream: NodeJS.WritableStream): void {
  stream.write(USAGE);
}

function runSchema(): number {
  const json = z.toJSONSchema(foolerySettingsSchema, {
    target: "draft-2020-12",
  });
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  return 0;
}

function defaultSettingsPath(): string {
  return path.join(os.homedir(), ".config", "foolery", "settings.toml");
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readTomlFile(filePath: string): { ok: true; data: unknown }
  | { ok: false; exit: 2 } {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    process.stderr.write(
      `foolery config validate: cannot read ${filePath}: `
      + `${errMessage(err)}\n`,
    );
    return { ok: false, exit: 2 };
  }
  try {
    return { ok: true, data: parseToml(contents) };
  } catch (err) {
    process.stderr.write(
      `foolery config validate: TOML parse error in ${filePath}: `
      + `${errMessage(err)}\n`,
    );
    return { ok: false, exit: 2 };
  }
}

function formatPath(issuePath: ReadonlyArray<PropertyKey>): string {
  if (issuePath.length === 0) return "(root)";
  return issuePath.map((p) => String(p)).join(".");
}

function formatReceived(issue: z.core.$ZodIssue): string {
  if (!("input" in issue) || issue.input === undefined) return "";
  try {
    return ` (received: ${JSON.stringify(issue.input)})`;
  } catch {
    return ` (received: ${String(issue.input)})`;
  }
}

function formatIssues(error: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    lines.push(
      `  - ${formatPath(issue.path)}: ${issue.message}${formatReceived(issue)}`,
    );
  }
  return lines.join("\n");
}

function runValidate(argPath: string | undefined): number {
  const filePath = argPath ?? defaultSettingsPath();
  const read = readTomlFile(filePath);
  if (!read.ok) return read.exit;

  const result = foolerySettingsSchema.safeParse(read.data);
  if (result.success) {
    process.stdout.write(`OK ${filePath}\n`);
    return 0;
  }
  process.stderr.write(
    `foolery config validate: schema validation failed in ${filePath}:\n`
    + `${formatIssues(result.error)}\n`,
  );
  return 1;
}

function dispatch(argv: ReadonlyArray<string>): number {
  const [subcmd, ...rest] = argv;
  switch (subcmd) {
    case "schema":
      return runSchema();
    case "validate":
      return runValidate(rest[0]);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printUsage(process.stdout);
      return 0;
    default:
      printUsage(process.stderr);
      process.stderr.write(
        `\nfoolery config: unknown subcommand "${subcmd}"\n`,
      );
      return 2;
  }
}

function main(): void {
  try {
    process.exitCode = dispatch(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(
      `foolery config: unexpected error\n${errMessage(err)}\n`,
    );
    process.exitCode = 2;
  }
}

main();
