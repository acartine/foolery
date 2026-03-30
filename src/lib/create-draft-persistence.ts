const STORAGE_KEY = "foolery:create-beat-draft";

export interface CreateDraftData {
  title?: string;
  description?: string;
  type?: string;
  priority?: number;
  labels?: string[];
  acceptance?: string;
  blocks?: string[];
  blockedBy?: string[];
}

export function saveDraft(data: CreateDraftData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be unavailable — silently ignore
  }
}

export function loadDraft(): CreateDraftData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as CreateDraftData;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silently ignore
  }
}

export function hasDraft(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function mergeDraftDefaults(
  defaults: Record<string, unknown>,
  draft: CreateDraftData | null,
): Record<string, unknown> {
  if (!draft) return defaults;
  const merged = { ...defaults };
  if (draft.title) merged.title = draft.title;
  if (draft.description)
    merged.description = draft.description;
  if (draft.type) merged.type = draft.type;
  if (draft.priority !== undefined)
    merged.priority = draft.priority;
  if (draft.labels?.length) merged.labels = draft.labels;
  if (draft.acceptance)
    merged.acceptance = draft.acceptance;
  return merged;
}
