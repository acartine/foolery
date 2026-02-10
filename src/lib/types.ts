export type BeadType =
  | "bug"
  | "feature"
  | "task"
  | "epic"
  | "chore"
  | "merge-request"
  | "molecule"
  | "gate";

export type BeadStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "deferred"
  | "closed";

export type BeadPriority = 0 | 1 | 2 | 3 | 4;

export interface Bead {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  acceptance?: string;
  type: BeadType;
  status: BeadStatus;
  priority: BeadPriority;
  labels: string[];
  assignee?: string;
  owner?: string;
  parent?: string;
  due?: string;
  estimate?: number;
  created: string;
  updated: string;
  closed?: string;
  metadata?: Record<string, unknown>;
}

export interface BeadDependency {
  id: string;
  type: string;
  source: string;
  target: string;
}

export interface BdResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface RegisteredRepo {
  path: string;
  name: string;
  addedAt: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isBeadsRepo: boolean;
}

export interface BeadWithRepo extends Bead {
  _repoPath: string;
  _repoName: string;
}
