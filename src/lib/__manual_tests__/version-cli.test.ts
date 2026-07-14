/**
 * Manual integration test for the foolery version CLI flag.
 *
 * Builds a real CLI launcher artifact via bash and executes it, so it lives
 * in `__manual_tests__/` and is excluded from the default suite per
 * the project's Hermetic Test Policy. Run with `bun run test:manual`.
 *
 * Host preconditions:
 *   - `bash` available on PATH
 *   - Repo root == process.cwd()
 */

import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempPaths: string[] = [];
let cliPath = "";
let packageVersion = "";

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

async function buildCli() {
  const buildDir = await makeTempDir("foolery-version-cli-");
  const outputPath = join(buildDir, "foolery");
  const repoRoot = process.cwd();

  await execFileAsync("bash", ["scripts/build-cli.sh", outputPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NO_COLOR: "1",
      TERM: "dumb",
      FOOLERY_APP_DIR: repoRoot,
      FOOLERY_INSTALL_ROOT: repoRoot,
      FOOLERY_BIN_DIR: buildDir,
      FOOLERY_STATE_DIR: join(buildDir, "state"),
      FOOLERY_LAUNCHER_PATH: outputPath,
    },
  });

  return outputPath;
}

async function runVersion(flag: "--version" | "-V") {
  const home = await makeTempDir("foolery-version-home-");
  const cacheDir = await makeTempDir("foolery-version-cache-");
  const cacheFile = join(cacheDir, "update-check.cache");
  await writeFile(cacheFile, "1\nv999.0.0\n", "utf8");

  return execFileAsync(cliPath, [flag], {
    env: {
      ...process.env,
      HOME: home,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TERM: "dumb",
      FOOLERY_UPDATE_CHECK: "1",
      FOOLERY_UPDATE_CHECK_FILE: cacheFile,
    },
  });
}

beforeAll(async () => {
  cliPath = await buildCli();
  const packageJson = await readFile(join(process.cwd(), "package.json"), "utf8");
  packageVersion = JSON.parse(packageJson).version;
});

afterAll(async () => {
  await Promise.all(
    tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("foolery version CLI", () => {
  it.each(["--version", "-V"] as const)(
    "prints only the installed version for %s",
    async (flag) => {
      const { stdout, stderr } = await runVersion(flag);

      expect(stdout).toBe(`${packageVersion}\n`);
      expect(stderr).toBe("");
    },
  );

  it("reports installed and latest versions while updating", async () => {
    const root = await makeTempDir("foolery-update-cli-");
    const appDir = join(root, "app");
    const binDir = join(root, "bin");
    await mkdir(appDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(
      join(appDir, "package.json"),
      JSON.stringify({ version: "0.14.17" }, null, 2),
      "utf8",
    );

    const curlPath = join(binDir, "curl");
    await writeFile(
      curlPath,
      String.raw`#!/usr/bin/env bash
set -euo pipefail
url="$*"
if [[ "$url" == *'/releases/latest' ]]; then
  printf '%s\n' '{"tag_name":"v0.14.18"}'
else
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'cd "$FOOLERY_APP_DIR"'
  printf '%s\n' 'sed '\''s/0.14.17/0.14.18/'\'' package.json > package.json.next'
  printf '%s\n' 'mv package.json.next package.json'
fi
`,
      "utf8",
    );
    await chmod(curlPath, 0o755);

    const { stdout, stderr } = await execFileAsync(cliPath, ["update"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        TERM: "dumb",
        FOOLERY_APP_DIR: appDir,
        FOOLERY_UPDATE_CHECK: "0",
      },
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("Installed version: 0.14.17");
    expect(stdout).toContain("Latest version:    0.14.18");
    expect(stdout).toContain(
      "Update complete: 0.14.17 -> 0.14.18 (latest 0.14.18).",
    );
  });
});
