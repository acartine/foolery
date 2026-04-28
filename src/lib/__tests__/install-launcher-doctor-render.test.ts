import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const createdDirs: string[] = [];
const installScriptPath = join(process.cwd(), "scripts", "install.sh");

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function writeLauncher(launcherPath: string) {
  await execFileAsync(
    "bash",
    [
      "-lc",
      String.raw`
        set -euo pipefail
        script_path="$FOOLERY_TEST_INSTALL_SCRIPT"
        stripped="$(mktemp "/tmp/foolery-install-doctor-test.XXXXXX")"
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
        FOOLERY_LAUNCHER_PATH: launcherPath,
        FOOLERY_TEST_INSTALL_SCRIPT: installScriptPath,
      },
    },
  );
  await chmod(launcherPath, 0o755);
}

async function evalLauncher(launcherPath: string, body: string) {
  return execFileAsync(
    "bash",
    [
      "-lc",
      `
        set -euo pipefail
        launcher="$FOOLERY_TEST_GENERATED_LAUNCHER"
        stripped="$(mktemp "/tmp/foolery-launcher-doctor-test.XXXXXX")"
        trap 'rm -f "$stripped"' EXIT
        sed '$d' "$launcher" >"$stripped"
        source "$stripped"
        ${body}
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FOOLERY_TEST_GENERATED_LAUNCHER: launcherPath,
      },
    },
  );
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

const SAMPLE_DOCTOR_RESPONSE = JSON.stringify({
  ok: true,
  data: {
    timestamp: "2026-01-01T00:00:00.000Z",
    diagnostics: [
      {
        check: "agent-ping",
        severity: "info",
        message: "Agent foo is healthy.",
        fixable: false,
      },
    ],
    summary: { errors: 0, warnings: 0, infos: 1, fixable: 0 },
  },
});

describe("install launcher doctor rendering on Linux/Node 24", () => {
  it("render_doctor_report runs the inline node script without ENOENT", async () => {
    const tempRoot = await makeTempDir("foolery-launcher-doctor-render-");
    const binDir = join(tempRoot, "bin");
    const launcherPath = join(binDir, "foolery");
    await mkdir(binDir, { recursive: true });
    await writeLauncher(launcherPath);

    const { stdout, stderr } = await evalLauncher(
      launcherPath,
      String.raw`
        render_doctor_report '${SAMPLE_DOCTOR_RESPONSE}' 0
      `,
    );

    expect(stderr).not.toMatch(/ENOENT/);
    expect(stderr).not.toMatch(/no such file or directory/);
    expect(stdout).toContain("Foolery Doctor");
    expect(stdout).toContain("Agent foo is healthy.");
  });

  it("render_doctor_stream consumes NDJSON without ENOENT", async () => {
    const tempRoot = await makeTempDir("foolery-launcher-doctor-stream-");
    const binDir = join(tempRoot, "bin");
    const launcherPath = join(binDir, "foolery");
    await mkdir(binDir, { recursive: true });
    await writeLauncher(launcherPath);

    const stubServer = join(binDir, "curl");
    const ndjson = [
      `{"category":"agents","label":"Agent connectivity","status":"pass","summary":"all healthy","diagnostics":[]}`,
      `{"done":true,"passed":1,"failed":0,"warned":0,"fixable":0}`,
    ].join("\n");
    const escaped = ndjson.replace(/'/g, "'\\''");
    const stub = `#!/usr/bin/env bash\nprintf '%s\\n' '${escaped}'\n`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(stubServer, stub, "utf8");
    await chmod(stubServer, 0o755);

    const { stdout, stderr } = await evalLauncher(
      launcherPath,
      String.raw`
        export PATH="${binDir}:$PATH"
        render_doctor_stream
      `,
    );

    expect(stderr).not.toMatch(/ENOENT/);
    expect(stderr).not.toMatch(/no such file or directory/);
    expect(stdout).toContain("Foolery Doctor");
    expect(stdout).toContain("Agent connectivity");
    expect(stdout).toContain("All clear");
  });

  it("render_doctor_report cleans up its temp script file", async () => {
    const tempRoot = await makeTempDir("foolery-launcher-doctor-cleanup-");
    const binDir = join(tempRoot, "bin");
    const launcherPath = join(binDir, "foolery");
    await mkdir(binDir, { recursive: true });
    await writeLauncher(launcherPath);

    const tmpProbe = join(tempRoot, "tmp");
    await mkdir(tmpProbe, { recursive: true });

    await evalLauncher(
      launcherPath,
      String.raw`
        export TMPDIR="${tmpProbe}"
        render_doctor_report '${SAMPLE_DOCTOR_RESPONSE}' 0 >/dev/null
      `,
    );

    const { readdir } = await import("node:fs/promises");
    const leftover = await readdir(tmpProbe);
    expect(
      leftover.filter((name) => name.startsWith("foolery-doctor-render.")),
    ).toEqual([]);
  });
});
