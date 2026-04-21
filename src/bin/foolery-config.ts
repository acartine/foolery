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

import { z } from "zod/v4";

import { foolerySettingsSchema } from "../lib/schemas";
import {
  defaultSettingsPath,
  formatIssues,
  validateSettingsToml,
} from "../lib/settings-validate";

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

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function runValidate(argPath: string | undefined): number {
  const filePath = argPath ?? defaultSettingsPath();
  const result = validateSettingsToml(filePath);

  switch (result.kind) {
    case "ok":
      process.stdout.write(`OK ${filePath}\n`);
      return 0;
    case "file-error":
      process.stderr.write(
        `foolery config validate: cannot read ${filePath}: `
        + `${result.message}\n`,
      );
      return 2;
    case "parse-error":
      process.stderr.write(
        `foolery config validate: TOML parse error in ${filePath}: `
        + `${result.message}\n`,
      );
      return 2;
    case "schema-error":
      process.stderr.write(
        `foolery config validate: schema validation failed in ${filePath}:\n`
        + `${formatIssues(result.error)}\n`,
      );
      return 1;
  }
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
