import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { homedir } from "node:os";
import type { MemoryManagerType } from "@/lib/memory-managers";
import { getKnownMemoryManagerMarkers, isKnownMemoryManagerType } from "@/lib/memory-managers";
import { detectMemoryManagerType } from "@/lib/memory-manager-detection";

export interface RegisteredRepo {
  path: string;
  name: string;
  addedAt: string;
  memoryManagerType?: MemoryManagerType;
}

interface Registry {
  repos: RegisteredRepo[];
}

export interface RepoMemoryManagerAuditResult {
  missingRepoPaths: string[];
  fileMissing: boolean;
  error?: string;
}

export interface RepoMemoryManagerBackfillResult {
  changed: boolean;
  migratedRepoPaths: string[];
  fileMissing: boolean;
  error?: string;
}

const CONFIG_DIR = `${homedir()}/.config/foolery`;
const REGISTRY_FILE = `${CONFIG_DIR}/registry.json`;

function defaultMemoryManagerType(repoPath: string): MemoryManagerType {
  return detectMemoryManagerType(repoPath) ?? "beads";
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

  const configuredMemoryManager =
    typeof record.memoryManagerType === "string" ? record.memoryManagerType : undefined;
  const memoryManagerType = isKnownMemoryManagerType(configuredMemoryManager)
    ? configuredMemoryManager
    : defaultMemoryManagerType(path);
  return { path, name, addedAt, memoryManagerType };
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

async function readRawRegistry(): Promise<{
  parsed: unknown;
  fileMissing: boolean;
  error?: string;
}> {
  let raw: string;
  try {
    raw = await readFile(REGISTRY_FILE, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { parsed: {}, fileMissing: true };
    }
    return { parsed: {}, fileMissing: false, error: formatError(error) };
  }

  try {
    return { parsed: JSON.parse(raw) as unknown, fileMissing: false };
  } catch (error) {
    return { parsed: {}, fileMissing: false, error: formatError(error) };
  }
}

function collectMissingMemoryManagerRepoPaths(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.repos)) return [];

  return record.repos.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const repo = entry as Record<string, unknown>;
    if (typeof repo.path !== "string" || repo.path.length === 0) return [];

    const configuredMemoryManager = repo.memoryManagerType;
    const hasMemoryManager =
      typeof configuredMemoryManager === "string" && configuredMemoryManager.length > 0;
    return hasMemoryManager ? [] : [repo.path];
  });
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
  const memoryManagerType = detectMemoryManagerType(repoPath);
  if (!memoryManagerType) {
    const expected = getKnownMemoryManagerMarkers().join(", ");
    throw new Error(
      `No supported memory manager found at ${repoPath}. Expected one of: ${expected}`,
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
    memoryManagerType,
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

export async function inspectMissingRepoMemoryManagerTypes(): Promise<RepoMemoryManagerAuditResult> {
  const raw = await readRawRegistry();
  return {
    missingRepoPaths: raw.error ? [] : collectMissingMemoryManagerRepoPaths(raw.parsed),
    fileMissing: raw.fileMissing,
    error: raw.error,
  };
}

export async function backfillMissingRepoMemoryManagerTypes(): Promise<RepoMemoryManagerBackfillResult> {
  const raw = await readRawRegistry();
  if (raw.error) {
    return {
      changed: false,
      migratedRepoPaths: [],
      fileMissing: raw.fileMissing,
      error: raw.error,
    };
  }

  if (raw.fileMissing) {
    return {
      changed: false,
      migratedRepoPaths: [],
      fileMissing: true,
    };
  }

  if (typeof raw.parsed !== "object" || raw.parsed === null) {
    return {
      changed: false,
      migratedRepoPaths: [],
      fileMissing: false,
    };
  }

  const record = raw.parsed as Record<string, unknown>;
  if (!Array.isArray(record.repos)) {
    return {
      changed: false,
      migratedRepoPaths: [],
      fileMissing: false,
    };
  }

  const migratedRepoPaths: string[] = [];
  const repos = record.repos.map((rawRepo) => {
    if (typeof rawRepo !== "object" || rawRepo === null) return rawRepo;
    const repo = rawRepo as Record<string, unknown>;
    if (typeof repo.path !== "string" || repo.path.length === 0) return rawRepo;

    const configuredMemoryManager = repo.memoryManagerType;
    if (typeof configuredMemoryManager === "string" && configuredMemoryManager.length > 0) {
      return rawRepo;
    }

    const memoryManagerType = defaultMemoryManagerType(repo.path);
    migratedRepoPaths.push(repo.path);
    return { ...repo, memoryManagerType };
  });

  if (migratedRepoPaths.length === 0) {
    return {
      changed: false,
      migratedRepoPaths: [],
      fileMissing: false,
    };
  }

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(
    REGISTRY_FILE,
    JSON.stringify({ ...record, repos }, null, 2),
    "utf-8",
  );

  return {
    changed: true,
    migratedRepoPaths,
    fileMissing: false,
  };
}
