/**
 * Manual integration test for the foolery launcher setup command.
 *
 * Touches the real filesystem and spawns real bash processes, so it lives
 * in `__manual_tests__/` and is excluded from the default suite per
 * the project's Hermetic Test Policy. Run with `bun run test:manual`.
 *
 * Host preconditions:
 *   - `bash` available on PATH
 *   - scripts/install.sh relative to repo root is readable
 *   - Repo root == process.cwd()
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const createdDirs: string[] = [];
const repoRoot = process.cwd();
const installScriptPath = join(repoRoot, "scripts", "install.sh");
const sourceSkillPath = join(
  repoRoot,
  ".claude",
  "skills",
  "foolery-configure",
  "SKILL.md",
);

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

interface GeneratedEnv {
  binDir: string;
  launcherPath: string;
  appDir: string;
  stateDir: string;
  tempRoot: string;
}

async function generateLauncherEnv(prefix: string): Promise<GeneratedEnv> {
  const tempRoot = await makeTempDir(prefix);
  const binDir = join(tempRoot, "bin");
  const appDir = join(tempRoot, "runtime");
  const stateDir = join(tempRoot, "state");
  const launcherPath = join(binDir, "foolery");

  await mkdir(binDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  await execFileAsync(
    "bash",
    [
      "-lc",
      String.raw`
        set -euo pipefail
        script_path="$FOOLERY_TEST_INSTALL_SCRIPT"
        stripped="$(mktemp "/tmp/foolery-install-test.XXXXXX")"
        trap 'rm -f "$stripped"' EXIT
        sed '$d' "$script_path" >"$stripped"
        source "$stripped"
        write_launcher
      `,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        FOOLERY_LAUNCHER_PATH: launcherPath,
        FOOLERY_APP_DIR: appDir,
        FOOLERY_STATE_DIR: stateDir,
        FOOLERY_TEST_INSTALL_SCRIPT: installScriptPath,
      },
    },
  );

  return { binDir, launcherPath, appDir, stateDir, tempRoot };
}

async function installSkillInto(appDir: string) {
  const target = join(appDir, "skills", "foolery-configure");
  await mkdir(target, { recursive: true });
  const skill = await readFile(sourceSkillPath, "utf8");
  await writeFile(join(target, "SKILL.md"), skill, "utf8");
}

async function writeRecordingStub(
  binDir: string,
  name: string,
  logFile: string,
  captureStdin = false,
) {
  const stdinBlock = captureStdin
    ? `printf -- '--- STDIN ---\\n' >>"${logFile}"\ncat >>"${logFile}"\n`
    : "";
  const script = `#!/usr/bin/env bash
# Recording stub for '${name}'. Writes argv${
    captureStdin ? " and stdin" : ""
  } to the log file.
: >"${logFile}"
printf 'ARGC=%d\\n' "$#" >>"${logFile}"
for arg in "$@"; do
  printf 'ARG=%s\\n' "$arg" >>"${logFile}"
done
${stdinBlock}exit 0
`;
  const path = join(binDir, name);
  await writeFile(path, script, "utf8");
  await chmod(path, 0o755);
  return path;
}

async function runLauncher(
  env: GeneratedEnv,
  args: string[],
  overrides: Record<string, string> = {},
) {
  return execFileAsync(env.launcherPath, args, {
    cwd: env.tempRoot,
    env: {
      ...process.env,
      HOME: env.tempRoot,
      PATH: `${env.binDir}:/usr/bin:/bin`,
      FOOLERY_APP_DIR: env.appDir,
      FOOLERY_STATE_DIR: env.stateDir,
      FOOLERY_INSTALL_ROOT: env.tempRoot,
      FOOLERY_LAUNCHER_PATH: env.launcherPath,
      FOOLERY_UPDATE_CHECK: "0",
      TERM: "dumb",
      NO_COLOR: "1",
      ...overrides,
    },
  });
}

async function expectLauncherFailure(
  env: GeneratedEnv,
  overrides: Record<string, string> = {},
) {
  try {
    await runLauncher(env, ["setup"], overrides);
    return { stdout: "", stderr: "", code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("foolery setup launcher", () => {
  it("pipes SKILL.md stdin to claude when present on PATH", async () => {
    const env = await generateLauncherEnv("foolery-setup-claude-");
    await installSkillInto(env.appDir);
    const logFile = join(env.tempRoot, "claude.log");
    await writeRecordingStub(env.binDir, "claude", logFile, true);

    await runLauncher(env, ["setup"]);

    const log = await readFile(logFile, "utf8");
    expect(log).toContain("ARGC=0");
    expect(log).toContain("--- STDIN ---");
    const sourceSkill = await readFile(sourceSkillPath, "utf8");
    const stdinChunk = log.split("--- STDIN ---\n")[1] ?? "";
    expect(stdinChunk).toBe(sourceSkill);
  });

  it("falls through to codex when claude is absent", async () => {
    const env = await generateLauncherEnv("foolery-setup-codex-");
    await installSkillInto(env.appDir);
    const logFile = join(env.tempRoot, "codex.log");
    await writeRecordingStub(env.binDir, "codex", logFile);

    await runLauncher(env, ["setup"]);

    const log = await readFile(logFile, "utf8");
    const sourceSkill = await readFile(sourceSkillPath, "utf8");
    expect(log).toContain("ARGC=2");
    expect(log).toContain("ARG=exec");
    expect(log).toContain(`ARG=${sourceSkill.split("\n")[0]}`);
  });

  it("honors FOOLERY_SETUP_AGENT override when multiple CLIs are available", async () => {
    const env = await generateLauncherEnv("foolery-setup-override-");
    await installSkillInto(env.appDir);
    const claudeLog = join(env.tempRoot, "claude.log");
    const geminiLog = join(env.tempRoot, "gemini.log");
    await writeRecordingStub(env.binDir, "claude", claudeLog);
    await writeRecordingStub(env.binDir, "gemini", geminiLog);

    await runLauncher(env, ["setup"], { FOOLERY_SETUP_AGENT: "gemini" });

    const claudeContent = await readFile(claudeLog, "utf8").catch(() => "");
    expect(claudeContent).toBe("");
    const gemini = await readFile(geminiLog, "utf8");
    expect(gemini).toContain("ARG=-p");
  });

  it("exits loudly with UI fallback when no agent CLI is on PATH", async () => {
    const env = await generateLauncherEnv("foolery-setup-noagent-");
    await installSkillInto(env.appDir);

    const { code, stderr } = await expectLauncherFailure(env);

    expect(code).not.toBe(0);
    expect(stderr).toContain("no agent CLI found on PATH");
    expect(stderr).toContain("claude, codex, opencode, gemini, copilot");
    expect(stderr).toContain("FOOLERY_SETUP_AGENT");
    expect(stderr).toContain("foolery start && foolery open");
    expect(stderr).toContain("No agent CLI available for foolery setup.");
  });

  it("exits loudly when FOOLERY_SETUP_AGENT override is not on PATH", async () => {
    const env = await generateLauncherEnv("foolery-setup-bad-override-");
    await installSkillInto(env.appDir);
    const logFile = join(env.tempRoot, "claude.log");
    await writeRecordingStub(env.binDir, "claude", logFile);

    const { code, stderr } = await expectLauncherFailure(env, {
      FOOLERY_SETUP_AGENT: "nonexistent-cli",
    });

    expect(code).not.toBe(0);
    expect(stderr).toContain("override 'nonexistent-cli'");
    expect(stderr).toContain("FOOLERY_SETUP_AGENT");
  });

  it("fails when the skill is missing from the installed runtime", async () => {
    const env = await generateLauncherEnv("foolery-setup-no-skill-");
    await writeRecordingStub(env.binDir, "claude", join(env.tempRoot, "claude.log"));

    const { code, stderr } = await expectLauncherFailure(env);

    expect(code).not.toBe(0);
    expect(stderr).toContain("foolery-configure skill missing");
    expect(stderr).toContain("foolery update");
  });
});
