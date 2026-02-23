import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { homedir } from "node:os";
import type { IssueTrackerType } from "@/lib/issue-trackers";
import { getKnownTrackerMarkers, isKnownIssueTrackerType } from "@/lib/issue-trackers";
import { detectIssueTrackerType } from "@/lib/issue-tracker-detection";

export interface RegisteredRepo {
  path: string;
  name: string;
  addedAt: string;
  trackerType?: IssueTrackerType;
}

interface Registry {
  repos: RegisteredRepo[];
}

const CONFIG_DIR = `${homedir()}/.config/foolery`;
const REGISTRY_FILE = `${CONFIG_DIR}/registry.json`;

function defaultTrackerType(repoPath: string): IssueTrackerType {
  return detectIssueTrackerType(repoPath) ?? "beads";
}

function normalizeRepo(raw: unknown): RegisteredRepo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.length === 0) return null;

  const path = record.path;
  const name =
    typeof record.name === "string" && record.name.length > 0
      ? record.name
      : basename(path);
  const addedAt =
    typeof record.addedAt === "string" && record.addedAt.length > 0
      ? record.addedAt
      : new Date(0).toISOString();

  const configuredTracker =
    typeof record.trackerType === "string" ? record.trackerType : undefined;
  const trackerType = isKnownIssueTrackerType(configuredTracker)
    ? configuredTracker
    : defaultTrackerType(path);
  return { path, name, addedAt, trackerType };
}

function normalizeRegistry(raw: unknown): Registry {
  if (typeof raw !== "object" || raw === null) return { repos: [] };
  const record = raw as Record<string, unknown>;
  const repos = Array.isArray(record.repos)
    ? record.repos
      .map(normalizeRepo)
      .filter((repo): repo is RegisteredRepo => repo !== null)
    : [];
  return { repos };
}

export async function loadRegistry(): Promise<Registry> {
  try {
    const raw = await readFile(REGISTRY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRegistry(parsed);
  } catch {
    return { repos: [] };
  }
}

export async function saveRegistry(registry: Registry): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

export async function addRepo(repoPath: string): Promise<RegisteredRepo> {
  const trackerType = detectIssueTrackerType(repoPath);
  if (!trackerType) {
    const expected = getKnownTrackerMarkers().join(", ");
    throw new Error(
      `No supported issue tracker found at ${repoPath}. Expected one of: ${expected}`,
    );
  }

  const registry = await loadRegistry();
  if (registry.repos.some((r) => r.path === repoPath)) {
    throw new Error(`Repository already registered: ${repoPath}`);
  }

  const repo: RegisteredRepo = {
    path: repoPath,
    name: basename(repoPath),
    addedAt: new Date().toISOString(),
    trackerType,
  };
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
