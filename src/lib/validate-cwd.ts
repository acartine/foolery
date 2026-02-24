import { access, constants } from "node:fs/promises";

/**
 * Validate that the given CWD path exists and is readable.
 *
 * Returns `null` when the path is valid, or a structured error message
 * containing the keywords `error_during_execution` and `cwd` so that
 * `classifyTerminalFailure` can detect it as a `missing_cwd` failure.
 */
export async function validateCwd(cwd: string): Promise<string | null> {
  try {
    await access(cwd, constants.R_OK);
    return null;
  } catch {
    return [
      `error_during_execution: cwd path missing`,
      `Path "${cwd}" does not exist. The worktree or working directory was removed before the session could start.`,
    ].join("\n");
  }
}
