import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const createdDirs: string[] = [];

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
          FOOLERY_TEST_INSTALL_SCRIPT: join(process.cwd(), "scripts", "install.sh"),
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
});
