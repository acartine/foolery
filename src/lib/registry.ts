import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface RegisteredRepo {
  path: string;
  name: string;
  addedAt: string;
}

interface Registry {
  repos: RegisteredRepo[];
}

const CONFIG_DIR = join(homedir(), ".config", "foolery");
const REGISTRY_FILE = join(CONFIG_DIR, "registry.json");

export async function loadRegistry(): Promise<Registry> {
  try {
    const raw = await readFile(REGISTRY_FILE, "utf-8");
    return JSON.parse(raw) as Registry;
  } catch {
    return { repos: [] };
  }
}

export async function saveRegistry(registry: Registry): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

export async function addRepo(repoPath: string): Promise<RegisteredRepo> {
  const beadsDir = join(repoPath, ".beads");
  if (!existsSync(beadsDir)) {
    throw new Error(`No .beads/ directory found at ${repoPath}`);
  }
  const registry = await loadRegistry();
  if (registry.repos.some((r) => r.path === repoPath)) {
    throw new Error(`Repository already registered: ${repoPath}`);
  }
  const name = repoPath.split("/").pop() ?? repoPath;
  const repo: RegisteredRepo = { path: repoPath, name, addedAt: new Date().toISOString() };
  registry.repos.push(repo);
  await saveRegistry(registry);
  return repo;
}

export async function removeRepo(repoPath: string): Promise<void> {
  const registry = await loadRegistry();
  registry.repos = registry.repos.filter((r) => r.path !== repoPath);
  await saveRegistry(registry);
}

export async function listRepos(): Promise<RegisteredRepo[]> {
  const registry = await loadRegistry();
  return registry.repos;
}
