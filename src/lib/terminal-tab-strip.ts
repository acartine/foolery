const TAB_STRIP_EPSILON = 1;
const COMPACT_TAB_WIDTH_THRESHOLD = 190;
const COMPACT_TAB_PREFIX_MAX = 10;
const COMPACT_TAB_LOCAL_ID_MAX = 12;

export interface TerminalTabStripMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface TerminalTabStripState {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

export interface TerminalTabLabelParts {
  prefix: string | null;
  localId: string;
}

export interface TerminalTabDisplayLabel {
  prefix: string | null;
  localId: string;
}

function truncateEnd(value: string, maxChars: number): string {
  if (value.length <= maxChars || maxChars <= 3) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars || maxChars <= 3) return value;
  const sideChars = Math.max(1, Math.floor((maxChars - 3) / 2));
  const endChars = Math.max(1, maxChars - 3 - sideChars);
  return `${value.slice(0, sideChars)}...${value.slice(value.length - endChars)}`;
}

export function resolveTerminalTabDisplayLabel(
  parts: TerminalTabLabelParts,
  compact: boolean,
): TerminalTabDisplayLabel {
  if (!compact) {
    return {
      prefix: parts.prefix ? `${parts.prefix}-` : null,
      localId: parts.localId,
    };
  }

  return {
    prefix: parts.prefix ? `${truncateEnd(parts.prefix, COMPACT_TAB_PREFIX_MAX)}-` : null,
    localId: truncateMiddle(parts.localId, COMPACT_TAB_LOCAL_ID_MAX),
  };
}

export function resolveTerminalTabStripState(
  metrics: TerminalTabStripMetrics,
): TerminalTabStripState {
  const maxScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const boundedScrollLeft = Math.min(Math.max(metrics.scrollLeft, 0), maxScrollLeft);
  const hasOverflow = maxScrollLeft > TAB_STRIP_EPSILON;

  return {
    hasOverflow,
    canScrollLeft: hasOverflow && boundedScrollLeft > TAB_STRIP_EPSILON,
    canScrollRight:
      hasOverflow && maxScrollLeft - boundedScrollLeft > TAB_STRIP_EPSILON,
  };
}

export function shouldUseCompactTerminalTabLabels(
  hasOverflow: boolean,
  clientWidth: number,
  tabCount: number,
): boolean {
  if (!hasOverflow || tabCount <= 0) return false;
  return clientWidth / tabCount < COMPACT_TAB_WIDTH_THRESHOLD;
}

export function getTerminalTabScrollAmount(clientWidth: number): number {
  return Math.max(120, Math.round(clientWidth * 0.72));
}
