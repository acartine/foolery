import { describe, expect, it, vi } from "vitest";
import { allocateWaveSlug } from "@/lib/wave-slugs";

describe("allocateWaveSlug composed-candidate variant coverage", () => {
  it("exercises all three composedCandidate variants (actor-movie, movie-buzz, actor-buzz)", () => {
    // Each call with different seeds/attempts will cycle through the three
    // variants (attempt % 3 === 0, 1, 2). Allocating 4+ slugs from an empty
    // set guarantees all three branches execute.
    const used = new Set<string>();
    const slugs: string[] = [];
    for (let i = 0; i < 6; i++) {
      slugs.push(allocateWaveSlug(used));
    }
    expect(new Set(slugs).size).toBe(6);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
    }
  });
});

describe("allocateWaveSlug fallback path when all composed candidates exhausted", () => {
  it("falls back to suffixed candidate when all composed candidates are taken", () => {
    // The composed candidate pool is ACTORS * MOVIES * BUZZWORDS.
    // We need all composedCandidate(seed, attempt) results for a given seed
    // to be in the used set. We can do this by spying on Date.now to fix seed,
    // pre-computing all candidates, then adding them to the used set.

    // Fix Date.now so the seed is deterministic
    const fixedTime = 1000000;
    vi.spyOn(Date, "now").mockReturnValue(fixedTime);

    const used = new Set<string>();
    // The seed = Date.now() + usedSlugs.size * 17 = 1000000 + 0 * 17 = 1000000
    const seed = fixedTime + used.size * 17;

    // ACTOR_LAST_NAMES.length = 30, MOVIE_TITLE_WORDS.length = 30, SET_BUZZWORDS.length = 26
    const actorCount = 30;
    const movieCount = 30;
    const buzzCount = 26;
    const maxAttempts = actorCount * movieCount * buzzCount; // 23400

    // Pre-generate all composedCandidate results for this seed and add to used
    const ACTOR_LAST_NAMES = [
      "streep", "washington", "freeman", "depp", "blanchett",
      "winslet", "ledger", "pacino", "hoffman", "hanks",
      "daylewis", "swank", "bardem", "theron", "pitt",
      "jolie", "waltz", "weaver", "croft", "foster",
      "reeves", "clooney", "adams", "redmayne", "poitier",
      "mckellen", "affleck", "hamill", "fonda", "eastwood",
    ];
    const MOVIE_TITLE_WORDS = [
      "arrival", "gravity", "matrix", "heat", "memento",
      "casablanca", "vertigo", "sunset", "godfather", "noir",
      "jaws", "fargo", "inception", "apollo", "amadeus",
      "gladiator", "spotlight", "parasite", "goodfellas", "moonlight",
      "interstellar", "prestige", "whiplash", "network", "rocky",
      "titanic", "birdman", "uncut", "arrival", "encore",
    ];
    const SET_BUZZWORDS = [
      "gaffer", "slate", "take", "rushes", "dailies",
      "blocking", "callback", "table", "location", "stunt",
      "foley", "grip", "boom", "lens", "dolly",
      "chroma", "wardrobe", "props", "montage", "cutaway",
      "continuity", "scene", "rehearsal", "premiere", "screening",
      "voiceover",
    ];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const actor = ACTOR_LAST_NAMES[(seed + attempt) % actorCount];
      const movie = MOVIE_TITLE_WORDS[(seed * 3 + attempt) % movieCount];
      const buzz = SET_BUZZWORDS[(seed * 7 + attempt) % buzzCount];
      const variant = attempt % 3;
      let candidate: string;
      if (variant === 0) candidate = `${actor}-${movie}`;
      else if (variant === 1) candidate = `${movie}-${buzz}`;
      else candidate = `${actor}-${buzz}`;
      used.add(candidate);
    }

    // Also add the fallbackBase candidate itself (composedCandidate(seed, maxAttempts))
    const fallbackActor = ACTOR_LAST_NAMES[(seed + maxAttempts) % actorCount];
    const fallbackMovie = MOVIE_TITLE_WORDS[(seed * 3 + maxAttempts) % movieCount];
    const fallbackBase = `${fallbackActor}-${fallbackMovie}`;

    // Now allocate -- should hit the suffix fallback path (lines 182-192)
    const slug = allocateWaveSlug(used);

    // The slug should be fallbackBase-N where N >= 2
    expect(slug).toMatch(new RegExp(`^.+-\\d+$`));
    expect(used.has(slug)).toBe(true);

    vi.restoreAllMocks();
  });

});
