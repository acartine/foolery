import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PICKER_PATH = join(
  process.cwd(),
  "scripts",
  "model-picker.sh",
);

async function runFilter(
  query: string,
  models: string[],
): Promise<string[]> {
  const modelsArgs = models
    .map((m) => JSON.stringify(m))
    .join(" ");
  const { stdout } = await execFileAsync("bash", [
    "-lc",
    `
      source "$1"
      _model_picker_filter ${JSON.stringify(query)} ${modelsArgs}
    `,
    "bash",
    PICKER_PATH,
  ]);
  return stdout.trim().split("\n").filter(Boolean);
}

describe("_model_picker_filter", () => {
  const MODELS = [
    "glm-4-plus",
    "glm-4-air",
    "minimax-01",
    "qwen-2.5-72b",
    "qwen-turbo",
    "gpt-5.3",
    "claude-sonnet-4.5",
    "gemini-2.5-pro",
  ];

  it("returns all models for empty query", async () => {
    const result = await runFilter("", MODELS);
    expect(result).toEqual(MODELS);
  });

  it("filters case-insensitively for GLM", async () => {
    const result = await runFilter("GLM", MODELS);
    expect(result).toEqual(["glm-4-plus", "glm-4-air"]);
  });

  it("filters case-insensitively for glm", async () => {
    const result = await runFilter("glm", MODELS);
    expect(result).toEqual(["glm-4-plus", "glm-4-air"]);
  });

  it("finds minimax models", async () => {
    const result = await runFilter("minimax", MODELS);
    expect(result).toEqual(["minimax-01"]);
  });

  it("finds qwen models with mixed case", async () => {
    const result = await runFilter("Qwen", MODELS);
    expect(result).toEqual(["qwen-2.5-72b", "qwen-turbo"]);
  });

  it("returns empty for non-matching query", async () => {
    const result = await runFilter("nonexistent", MODELS);
    expect(result).toEqual([]);
  });

  it("matches partial substrings", async () => {
    const result = await runFilter("pro", MODELS);
    expect(result).toEqual(["gemini-2.5-pro"]);
  });

  it("handles numeric queries", async () => {
    const result = await runFilter("2.5", MODELS);
    expect(result).toEqual([
      "qwen-2.5-72b",
      "gemini-2.5-pro",
    ]);
  });
});

describe("_MODEL_SEARCH_THRESHOLD", () => {
  it("is set to 20", async () => {
    const { stdout } = await execFileAsync("bash", [
      "-lc",
      `
        source "$1"
        printf '%d' "$_MODEL_SEARCH_THRESHOLD"
      `,
      "bash",
      PICKER_PATH,
    ]);
    expect(stdout).toBe("20");
  });
});
