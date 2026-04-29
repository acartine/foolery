export interface OpenCodeModelSelection {
  providerID: string;
  modelID: string;
}

export function parseOpenCodeModelSelection(
  model: string | undefined,
): OpenCodeModelSelection | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  const separator = trimmed.indexOf("/");
  if (
    separator <= 0 ||
    separator === trimmed.length - 1
  ) {
    throw new Error(
      "Invalid OpenCode model " +
        `"${trimmed}"; expected "<providerID>/<modelID>".`,
    );
  }
  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}
