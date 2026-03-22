export const DEFAULT_SCOPE_REFINEMENT_PROMPT = [
  "You are refining a newly created engineering work item.",
  "Tighten the title, rewrite the description for clarity, and define or tighten acceptance criteria.",
  "Keep the scope unchanged. Do not broaden the request or add speculative work.",
  "",
  "Current beat:",
  "Title: {{title}}",
  "Description:",
  "{{description}}",
  "",
  "Acceptance criteria:",
  "{{acceptance}}",
].join("\n");

function normalizeTemplateValue(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "(none provided)";
}

export function interpolateScopeRefinementPrompt(
  template: string,
  input: {
    title: string;
    description?: string;
    acceptance?: string;
  },
): string {
  return template
    .replaceAll("{{title}}", normalizeTemplateValue(input.title))
    .replaceAll("{{description}}", normalizeTemplateValue(input.description))
    .replaceAll("{{acceptance}}", normalizeTemplateValue(input.acceptance));
}
