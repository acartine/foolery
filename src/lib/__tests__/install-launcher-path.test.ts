import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const createdDirs: string[] = [];
const installScriptPath = join(process.cwd(), "scripts", "install.sh");
const runInstallMainScript = String.raw`
  set -euo pipefail
  script_path="$FOOLERY_TEST_INSTALL_SCRIPT"
  stripped="$(mktemp "/tmp/foolery-install-test.XXXXXX")"
  trap 'rm -f "$stripped"' EXIT
  sed '$d' "$script_path" >"$stripped"
  source "$stripped"
  install_runtime() { :; }
  write_launcher() { :; }
  main
`;

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function writeExecutable(path: string) {
  await writeFile(path, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await chmod(path, 0o755);
}

async function runInstallMainWithPathCli(cliName: string | null) {
  const tempRoot = await makeTempDir("foolery-install-runtime-cli-");
  const binDir = join(tempRoot, "bin");
  const installRoot = join(tempRoot, "install");
  const appDir = join(installRoot, "runtime");
  const stateDir = join(tempRoot, "state");
  const launcherPath = join(binDir, "foolery");

  await mkdir(binDir, { recursive: true });
  await Promise.all(
    ["curl", "tar", "node"].map((cmd) => writeExecutable(join(binDir, cmd))),
  );
  if (cliName) {
    await writeExecutable(join(binDir, cliName));
  }

  return execFileAsync(
    "/bin/bash",
    ["-lc", runInstallMainScript],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${binDir}:/usr/bin:/bin`,
        HOME: tempRoot,
        FOOLERY_INSTALL_ROOT: installRoot,
        FOOLERY_APP_DIR: appDir,
        FOOLERY_BIN_DIR: binDir,
        FOOLERY_STATE_DIR: stateDir,
        FOOLERY_LAUNCHER_PATH: launcherPath,
        FOOLERY_TEST_INSTALL_SCRIPT: installScriptPath,
      },
    },
  );
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("install launcher path overrides", () => {
  it("writes the generated launcher to FOOLERY_LAUNCHER_PATH", async () => {
    const tempRoot = await makeTempDir("foolery-install-launcher-");
    const binDir = join(tempRoot, "bin");
    const launcherPath = join(binDir, "foolery-release");
    await mkdir(binDir, { recursive: true });

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
        cwd: process.cwd(),
        env: {
          ...process.env,
          FOOLERY_BIN_DIR: binDir,
          FOOLERY_LAUNCHER_PATH: launcherPath,
          FOOLERY_TEST_INSTALL_SCRIPT: installScriptPath,
        },
      },
    );

    expect(await statOrNull(launcherPath)).not.toBeNull();
    expect(await statOrNull(join(binDir, "foolery"))).toBeNull();

    const launcher = await readFile(launcherPath, "utf8");
    expect(launcher).toContain("tip) printf '%s' '->' ;;");
    expect(launcher).not.toContain("tip) printf '->' ;;");
    expect(launcher).toContain("FOOLERY_SETUP_URL");
    expect(launcher).toContain(
      'FOOLERY_LAUNCHER_PATH="$LAUNCHER_PATH"',
    );
    expect(launcher).toContain(
      'FOOLERY_STATE_DIR="$STATE_DIR"',
    );
  });

  it.each([
    { cliName: "bd", shouldWarn: false },
    { cliName: "kno", shouldWarn: false },
    { cliName: "knots", shouldWarn: false },
    { cliName: null, shouldWarn: true },
  ])(
    "warns only when no supported runtime CLI is on PATH: $cliName",
    async ({ cliName, shouldWarn }) => {
      const { stderr } = await runInstallMainWithPathCli(cliName);

      const warning = "Neither bd nor Knots (kno/knots) is on PATH.";
      if (shouldWarn) {
        expect(stderr).toContain(warning);
        return;
      }

      expect(stderr).not.toContain(warning);
    },
  );
});
