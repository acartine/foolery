import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempPaths: string[] = [];
let cliPath = "";

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

async function buildCli() {
  const buildDir = await makeTempDir("foolery-help-cli-");
  const outputPath = join(buildDir, "foolery");

  await execFileAsync("bash", ["scripts/build-cli.sh", outputPath], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
  });

  return outputPath;
}

async function runHelp(env: Partial<NodeJS.ProcessEnv> = {}) {
  return execFileAsync(cliPath, ["--help"], {
    env: { ...process.env, ...env },
  });
}

beforeAll(async () => {
  cliPath = await buildCli();
});

afterAll(async () => {
  await Promise.all(
    tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("foolery help CLI", () => {
  it("stays plain when color is disabled", async () => {
    const help = await runHelp({
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TERM: "xterm-256color",
    });

    expect(help.stdout).toContain("Usage: foolery <command>");
    expect(help.stdout).toContain("Manage Foolery guidance prompt in AGENTS.md/CLAUDE.md");
    expect(help.stdout).not.toMatch(/\u001b\[[0-9;]*m/);
  });

  it("supports forced color with distinct command accents", async () => {
    const help = await runHelp({
      FORCE_COLOR: "1",
      NO_COLOR: "",
      TERM: "dumb",
    });

    expect(help.stdout).toContain("\u001b[1;36mUsage:");
    expect(help.stdout).toMatch(/\u001b\[1;32mstart\s+\u001b\[0m \u001b\[2mStart Foolery/);
    expect(help.stdout).toMatch(/\u001b\[1;34msetup\s+\u001b\[0m \u001b\[2mConfigure repos/);
    expect(help.stdout).toMatch(/\u001b\[1;33mdoctor\s+\u001b\[0m \u001b\[2mRun diagnostics/);
    expect(help.stdout).toMatch(/\u001b\[1;31muninstall\s+\u001b\[0m \u001b\[2mRemove Foolery runtime/);
  });
});
