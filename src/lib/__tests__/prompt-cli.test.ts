import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempPaths: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

async function buildCli() {
  const buildDir = await makeTempDir("foolery-prompt-cli-");
  const cliPath = join(buildDir, "foolery");

  await execFileAsync("bash", ["scripts/build-cli.sh", cliPath], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
  });

  return cliPath;
}

async function runPrompt(cliPath: string, repoPath: string, args: string[] = []) {
  return execFileAsync(cliPath, ["prompt", ...args], {
    cwd: repoPath,
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
  });
}

afterAll(async () => {
  await Promise.all(
    tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("foolery prompt CLI", () => {
  it("supports dry-run previews and removal", async () => {
    const cliPath = await buildCli();
    const repoPath = await makeTempDir("foolery-prompt-repo-");
    const agentsPath = join(repoPath, "AGENTS.md");

    await writeFile(agentsPath, "# Agents\n");

    const dryRun = await runPrompt(cliPath, repoPath, ["--dry-run"]);
    expect(dryRun.stdout).toContain("Would update:");
    expect(dryRun.stdout).toContain("Prompt dry run complete: 1 would update");
    expect(await readFile(agentsPath, "utf8")).not.toContain("FOOLERY_GUIDANCE_PROMPT_START");

    const applied = await runPrompt(cliPath, repoPath);
    expect(applied.stdout).toContain("Updated:");
    const appliedContent = await readFile(agentsPath, "utf8");
    expect(appliedContent).toContain("FOOLERY_GUIDANCE_PROMPT_START");

    const removeDryRun = await runPrompt(cliPath, repoPath, ["--remove", "--dry-run"]);
    expect(removeDryRun.stdout).toContain("Would remove Foolery guidance:");
    expect(removeDryRun.stdout).toContain("Prompt dry run complete: 1 would remove");
    expect(await readFile(agentsPath, "utf8")).toContain("FOOLERY_GUIDANCE_PROMPT_START");

    const removed = await runPrompt(cliPath, repoPath, ["--remove"]);
    expect(removed.stdout).toContain("Removed Foolery guidance:");
    const removedContent = await readFile(agentsPath, "utf8");
    expect(removedContent).not.toContain("FOOLERY_GUIDANCE_PROMPT_START");
  });

  it("shows prompt-specific help output", async () => {
    const cliPath = await buildCli();
    const repoPath = await makeTempDir("foolery-prompt-help-");

    const help = await runPrompt(cliPath, repoPath, ["--help"]);

    expect(help.stdout).toContain("Usage: foolery prompt [options]");
    expect(help.stdout).toContain("--remove");
    expect(help.stdout).toContain("--dry-run");
    expect(help.stdout).toContain("--help");
  });
});
