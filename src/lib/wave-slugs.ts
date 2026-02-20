export const ORCHESTRATION_WAVE_LABEL = "orchestration:wave";
export const ORCHESTRATION_WAVE_LABEL_PREFIX = `${ORCHESTRATION_WAVE_LABEL}:`;

const ACTOR_LAST_NAMES = [
  "streep",
  "washington",
  "freeman",
  "depp",
  "blanchett",
  "winslet",
  "ledger",
  "pacino",
  "hoffman",
  "hanks",
  "daylewis",
  "swank",
  "bardem",
  "theron",
  "pitt",
  "jolie",
  "waltz",
  "weaver",
  "croft",
  "foster",
  "reeves",
  "clooney",
  "adams",
  "redmayne",
  "poitier",
  "mckellen",
  "affleck",
  "hamill",
  "fonda",
  "eastwood",
] as const;

const MOVIE_TITLE_WORDS = [
  "arrival",
  "gravity",
  "matrix",
  "heat",
  "memento",
  "casablanca",
  "vertigo",
  "sunset",
  "godfather",
  "noir",
  "jaws",
  "fargo",
  "inception",
  "apollo",
  "amadeus",
  "gladiator",
  "spotlight",
  "parasite",
  "goodfellas",
  "moonlight",
  "interstellar",
  "prestige",
  "whiplash",
  "network",
  "rocky",
  "titanic",
  "birdman",
  "uncut",
  "arrival",
  "encore",
] as const;

const SET_BUZZWORDS = [
  "gaffer",
  "slate",
  "take",
  "rushes",
  "dailies",
  "blocking",
  "callback",
  "table",
  "location",
  "stunt",
  "foley",
  "grip",
  "boom",
  "lens",
  "dolly",
  "chroma",
  "wardrobe",
  "props",
  "montage",
  "cutaway",
  "continuity",
  "scene",
  "rehearsal",
  "premiere",
  "screening",
  "voiceover",
] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export function normalizeWaveSlugCandidate(value: string): string {
  return slugify(value);
}

export function isWaveLabel(label: string): boolean {
  return label === ORCHESTRATION_WAVE_LABEL || label.startsWith(ORCHESTRATION_WAVE_LABEL_PREFIX);
}

/** Labels that are internal bookkeeping and should not render as user-visible tag badges. */
export function isInternalLabel(label: string): boolean {
  return isWaveLabel(label) || label.startsWith("stage:") || label.startsWith("transition:");
}

/** Labels that should render but cannot be removed by the user (no X button). */
export function isReadOnlyLabel(label: string): boolean {
  return label.startsWith("attempts:") || label.startsWith("commit:");
}

/** Check if a bead is currently locked for verification transition. */
export function isTransitionLocked(labels: string[]): boolean {
  return labels.includes("transition:verification");
}

export function isWaveSlugLabel(label: string): boolean {
  return label.startsWith(ORCHESTRATION_WAVE_LABEL_PREFIX);
}

export function getWaveSlugLabels(labels: string[]): string[] {
  return labels.filter(isWaveSlugLabel);
}

export function extractWaveSlug(labels: string[]): string | null {
  for (const label of getWaveSlugLabels(labels)) {
    const raw = label.slice(ORCHESTRATION_WAVE_LABEL_PREFIX.length).trim();
    if (!raw) continue;
    const normalized = normalizeWaveSlugCandidate(raw);
    if (normalized) return normalized;
  }
  return null;
}

export function isLegacyNumericWaveSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && /^\d+$/.test(slug);
}

export function buildWaveSlugLabel(slug: string): string {
  return `${ORCHESTRATION_WAVE_LABEL_PREFIX}${normalizeWaveSlugCandidate(slug)}`;
}

function composedCandidate(seed: number, attempt: number): string {
  const actor = ACTOR_LAST_NAMES[(seed + attempt) % ACTOR_LAST_NAMES.length];
  const movie = MOVIE_TITLE_WORDS[(seed * 3 + attempt) % MOVIE_TITLE_WORDS.length];
  const buzz = SET_BUZZWORDS[(seed * 7 + attempt) % SET_BUZZWORDS.length];
  const variant = attempt % 3;
  if (variant === 0) return `${actor}-${movie}`;
  if (variant === 1) return `${movie}-${buzz}`;
  return `${actor}-${buzz}`;
}

export function allocateWaveSlug(
  usedSlugs: Set<string>,
  preferredSlug?: string
): string {
  const preferred = preferredSlug ? normalizeWaveSlugCandidate(preferredSlug) : "";
  if (preferred && !usedSlugs.has(preferred)) {
    usedSlugs.add(preferred);
    return preferred;
  }

  const seed = Date.now() + usedSlugs.size * 17;
  const maxAttempts =
    ACTOR_LAST_NAMES.length * MOVIE_TITLE_WORDS.length * SET_BUZZWORDS.length;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = composedCandidate(seed, attempt);
    if (usedSlugs.has(candidate)) continue;
    usedSlugs.add(candidate);
    return candidate;
  }

  const fallbackBase = composedCandidate(seed, maxAttempts);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${fallbackBase}-${suffix}`;
    if (usedSlugs.has(candidate)) continue;
    usedSlugs.add(candidate);
    return candidate;
  }

  const emergency = `${fallbackBase}-${Date.now()}`;
  usedSlugs.add(emergency);
  return emergency;
}

export function buildWaveTitle(slug: string, name: string): string {
  const cleanName = name.trim();
  if (!cleanName) return `Scene ${slug}`;
  return `Scene ${slug}: ${cleanName}`;
}

export function rewriteWaveTitleSlug(title: string, slug: string): string {
  const trimmed = title.trim();
  if (!trimmed) return `Scene ${slug}`;
  if (/^(?:wave|scene)\s+[^:]+:\s*/i.test(trimmed)) {
    return trimmed.replace(/^(?:wave|scene)\s+[^:]+:\s*/i, `Scene ${slug}: `);
  }
  return `Scene ${slug}: ${trimmed}`;
}
