export const DEFAULT_WAIT_SPINNER_WORDS = [
  "breakdancing",
  "looksmaxing",
  "caffeinating",
  "scheming",
] as const;

const DOT_FRAMES = [".", "..", "...", ".."] as const;

export function sanitizeWaitSpinnerWords(words: readonly string[] | undefined): string[] {
  if (!words || words.length === 0) {
    return [...DEFAULT_WAIT_SPINNER_WORDS];
  }

  return words
    .map((word) => word.trim())
    .filter((word, index, arr) => word.length > 0 && arr.indexOf(word) === index);
}

export function formatWaitSpinnerLabel(
  step: number,
  words?: readonly string[]
): string {
  const safeWords = sanitizeWaitSpinnerWords(words);
  if (safeWords.length === 0) return "...waiting...";

  const normalizedStep = Number.isFinite(step) ? Math.max(0, Math.trunc(step)) : 0;
  const dotFrame = DOT_FRAMES[normalizedStep % DOT_FRAMES.length];
  const wordIndex =
    Math.floor(normalizedStep / DOT_FRAMES.length) % safeWords.length;
  const word = safeWords[wordIndex]!;

  return `${dotFrame}${word}${dotFrame}`;
}
