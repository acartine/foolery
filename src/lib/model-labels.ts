export interface StrippedLabelPrefix {
  stripped: string[];
  prefix: string;
}

export interface ModelLabelOption {
  id: string;
  label: string;
}

/**
 * Strip a shared provider prefix from model labels only when the common
 * boundary ends at "/" or ":".
 */
export function stripCommonModelLabelPrefix(labels: string[]): StrippedLabelPrefix {
  if (labels.length <= 1) {
    return { stripped: labels, prefix: "" };
  }

  const first = labels[0];
  if (!first) {
    return { stripped: labels, prefix: "" };
  }

  let prefixLen = first.length;
  for (let idx = 1; idx < labels.length; idx++) {
    const label = labels[idx] ?? "";
    const limit = Math.min(prefixLen, label.length);
    let shared = 0;
    while (shared < limit && label[shared] === first[shared]) {
      shared++;
    }
    prefixLen = shared;
    if (prefixLen === 0) {
      return { stripped: labels, prefix: "" };
    }
  }

  let snapIdx = -1;
  for (let idx = prefixLen - 1; idx >= 0; idx--) {
    const char = first[idx];
    if (char === "/" || char === ":") {
      snapIdx = idx;
      break;
    }
  }

  const cut = snapIdx + 1;
  if (cut <= 1) {
    return { stripped: labels, prefix: "" };
  }

  const stripped = labels.map((label) => label.slice(cut));
  if (stripped.some((label) => label.length === 0)) {
    return { stripped: labels, prefix: "" };
  }

  return {
    stripped,
    prefix: first.slice(0, cut),
  };
}

/**
 * Build per-option display labels with shared-prefix stripping and collision
 * fallback so visually-identical stripped labels stay unambiguous.
 */
export function buildModelLabelDisplayMap<T extends ModelLabelOption>(
  options: T[],
): Map<string, string> {
  if (options.length === 0) return new Map();

  const labels = options.map((option) => option.label);
  const { stripped } = stripCommonModelLabelPrefix(labels);
  const strippedCounts = new Map<string, number>();

  for (const label of stripped) {
    strippedCounts.set(label, (strippedCounts.get(label) ?? 0) + 1);
  }

  const displayMap = new Map<string, string>();
  for (let idx = 0; idx < options.length; idx++) {
    const option = options[idx];
    const strippedLabel = stripped[idx] ?? option.label;
    const hasCollision = (strippedCounts.get(strippedLabel) ?? 0) > 1;
    displayMap.set(option.id, hasCollision ? option.label : strippedLabel);
  }

  return displayMap;
}
