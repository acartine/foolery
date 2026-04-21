"use client";

export interface ConversationLogTheme {
  /* section wrapper */
  container: string;
  sectionHeader: string;
  icon: string;
  heading: string;
  muted: string;
  link: string;
  debugButton: string;
  sessionLabel: string;
  sessionTabActive: string;
  sessionTabInactive: string;
  panel: string;
  panelDivider: string;
  refreshingText: string;
  countText: string;
  /* tab bar */
  tabBar: string;
  tabActive: string;
  tabInactive: string;
  /* session card */
  cardShell: string;
  cardHeader: string;
  cardText: string;
  cardMuted: string;
  emptySession: string;
  highlightRing: string;
  /* prompt entry */
  promptContainer: string;
  promptHeader: string;
  promptDirectionLabel: string;
  promptBadge: string;
  promptBody: string;
  promptIcon: string;
  /* response entry */
  responseContainer: string;
  responseHeader: string;
  responseDirectionLabel: string;
  responseMetaBadge: string;
  responseBody: string;
  responseIcon: string;
  /* raw event details */
  rawContainer: string;
  rawSummary: string;
  rawBody: string;
  /* session boundary */
  boundaryRow: string;
  /* interaction picker bar */
  pickerBar: string;
  pickerDropdownButton: string;
  pickerDropdownPanel: string;
  pickerOptionDefault: string;
  pickerOptionSelected: string;
  pickerOptionMeta: string;
  pickerNoItems: string;
  pickerSeparator: string;
  pickerDetailLabel: string;
  pickerDetailSwitch: string;
  pickerCount: string;
  /* filter dropdown */
  filterButton: string;
  filterBadgeCount: string;
  filterPanel: string;
  filterSectionLabel: string;
  filterLoadingText: string;
  filterOptionHover: string;
  filterCheckboxSelected: string;
  filterCheckboxDefault: string;
  filterOptionText: string;
  filterOptionDescription: string;
  filterFooterBar: string;
  filterFooterText: string;
  filterClearButton: string;
  /* dashed / loading messages */
  dashedBorder: string;
  loadingContainer: string;
  loadingMuted: string;
  /* badge tones */
  badgeInteractionScene: string;
  badgeInteractionDirect: string;
  badgeInteractionDefault: string;
  badgeStatusCompleted: string;
  badgeStatusError: string;
  badgeStatusAborted: string;
  badgeStatusRunning: string;
  badgeStatusDefault: string;
}

export function getConversationLogTheme(
  light: boolean,
): ConversationLogTheme {
  return light ? LIGHT : DARK;
}

const LIGHT: ConversationLogTheme = {
  /* section wrapper */
  container:
    "border-paper-200 bg-paper-100 text-ink-900 shadow-md",
  sectionHeader:
    "border-b border-paper-200 bg-paper-200",
  icon: "text-clay-700",
  heading: "text-ink-900",
  muted: "text-ink-500",
  link:
    "text-ink-600 underline-offset-2"
    + " hover:text-ink-900 hover:underline",
  debugButton:
    "h-7 gap-1.5 border border-paper-300 bg-paper-50"
    + " px-2.5 font-mono text-[13px] text-ink-700"
    + " hover:bg-paper-200 hover:text-ink-900",
  sessionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-ink-600",
  sessionTabActive:
    "border-clay-400 bg-clay-100 text-clay-800 shadow-sm",
  sessionTabInactive:
    "border-paper-300 bg-paper-50 text-ink-600"
    + " hover:border-paper-400"
    + " hover:bg-paper-200"
    + " hover:text-ink-900",
  panel:
    "overflow-y-auto bg-paper-100 p-3"
    + " outline-none focus-visible:ring-1"
    + " focus-visible:ring-clay-500/60",
  panelDivider: "border-r border-paper-200",
  refreshingText: "text-ink-600",
  countText: "text-ink-900",
  /* tab bar */
  tabBar:
    "border-b border-paper-200 bg-paper-200",
  tabActive:
    "border-b-2 border-clay-500 text-ink-900",
  tabInactive:
    "text-ink-500 hover:text-ink-700",
  /* session card */
  cardShell:
    "rounded border border-paper-200 bg-paper-50 shadow-xs",
  cardHeader:
    "border-b border-paper-200 bg-paper-100"
    + " px-3 py-2 font-mono text-[14px] leading-6"
    + " text-ink-800 subpixel-antialiased",
  cardText: "text-ink-800",
  cardMuted: "text-ink-500",
  emptySession:
    "rounded border border-paper-200"
    + " bg-paper-50 px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-ink-700 subpixel-antialiased",
  highlightRing:
    "rounded ring-2 ring-clay-500/45 shadow-sm"
    + " transition-all duration-300",
  /* prompt entry — user role per spec §3.1: ink-900 on paper-50 */
  promptContainer:
    "rounded border border-paper-200"
    + " bg-paper-50 px-3 py-2 shadow-xs",
  promptHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-ink-900"
    + " subpixel-antialiased",
  promptDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-ink-700",
  promptBadge:
    "border-paper-300 bg-paper-100"
    + " text-[13px] font-normal text-ink-800",
  promptBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-ink-900 subpixel-antialiased",
  promptIcon: "text-ink-700",
  /* response entry — assistant role per spec §3.1: ink-800 on paper-100
     with a clay-500 left rule */
  responseContainer:
    "rounded border border-paper-200 border-l-4 border-l-clay-500"
    + " bg-paper-100 px-3 py-2 shadow-xs",
  responseHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-ink-800"
    + " subpixel-antialiased",
  responseDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-clay-700",
  responseMetaBadge:
    "border-paper-200 bg-paper-50"
    + " text-[13px] font-normal text-ink-700",
  responseBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-ink-800 subpixel-antialiased",
  responseIcon: "text-clay-600",
  /* raw event details — tool / system role per spec §3.1:
     ink-700 on paper-200 mono */
  rawContainer:
    "mt-2 rounded border border-paper-300"
    + " bg-paper-200 px-2.5 py-2"
    + " text-[14px] font-mono"
    + " text-ink-700 subpixel-antialiased",
  rawSummary: "cursor-pointer text-ink-600",
  rawBody:
    "mt-1.5 whitespace-pre-wrap break-words"
    + " font-mono text-[14px] leading-6"
    + " text-ink-700",
  /* session boundary */
  boundaryRow:
    "rounded border border-paper-300"
    + " bg-paper-200 px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-ink-700 subpixel-antialiased",
  /* interaction picker bar */
  pickerBar:
    "flex flex-wrap items-center gap-2"
    + " border-b border-paper-200 bg-paper-50"
    + " px-3 py-1.5 font-mono text-[14px]"
    + " text-ink-800 subpixel-antialiased",
  pickerDropdownButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-paper-300 bg-paper-50"
    + " px-2.5 py-1 text-[14px] text-ink-700"
    + " hover:bg-paper-200",
  pickerDropdownPanel:
    "absolute left-0 top-full z-50 mt-1"
    + " max-h-48 w-72 overflow-y-auto rounded"
    + " border border-paper-200 bg-paper-50 shadow-lg",
  pickerOptionDefault: "text-ink-700",
  pickerOptionSelected:
    "bg-clay-100 text-clay-800",
  pickerOptionMeta: "text-ink-500",
  pickerNoItems: "text-ink-500",
  pickerSeparator: "text-paper-300",
  pickerDetailLabel: "text-ink-500",
  pickerDetailSwitch:
    "data-[state=checked]:bg-clay-500"
    + " data-[state=unchecked]:bg-paper-300",
  pickerCount: "text-ink-500",
  /* filter dropdown */
  filterButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-paper-300 bg-paper-50"
    + " px-2.5 py-1 text-[14px] text-ink-700"
    + " hover:bg-paper-200",
  filterBadgeCount:
    "rounded bg-clay-100 px-1.5"
    + " text-[12px] text-clay-700",
  filterPanel:
    "absolute left-0 top-full z-50 mt-1 w-80"
    + " rounded border border-paper-200"
    + " bg-paper-50 shadow-lg",
  filterSectionLabel:
    "px-1 text-[13px] uppercase"
    + " tracking-[0.18em] text-ink-500",
  filterLoadingText: "text-ink-500",
  filterOptionHover: "hover:bg-paper-200",
  filterCheckboxSelected:
    "border-clay-400 bg-clay-100 text-clay-700",
  filterCheckboxDefault:
    "border-paper-300 text-transparent",
  filterOptionText: "text-ink-800",
  filterOptionDescription: "text-ink-500",
  filterFooterBar:
    "flex items-center justify-between"
    + " border-t border-paper-200"
    + " bg-paper-100 px-2.5 py-1.5",
  filterFooterText: "text-ink-500",
  filterClearButton:
    "text-ink-600 hover:text-ink-900",
  /* dashed / loading messages */
  dashedBorder:
    "border-paper-300 bg-paper-50",
  loadingContainer:
    "border-paper-300 bg-paper-50 text-ink-900",
  loadingMuted: "text-ink-500",
  /* badge tones */
  badgeInteractionScene:
    "border-clay-300 bg-clay-50 text-clay-800",
  badgeInteractionDirect:
    "border-moss-200 bg-moss-100 text-moss-700",
  badgeInteractionDefault:
    "border-lake-400 bg-lake-100 text-lake-700",
  badgeStatusCompleted:
    "border-moss-200 bg-moss-100 text-moss-700",
  badgeStatusError:
    "border-rust-400 bg-rust-100 text-rust-700",
  badgeStatusAborted:
    "border-ochre-400 bg-ochre-100 text-ochre-700",
  badgeStatusRunning:
    "border-lake-400 bg-lake-100 text-lake-700",
  badgeStatusDefault:
    "border-paper-200 bg-paper-50 text-ink-600",
};

const DARK: ConversationLogTheme = {
  /* section wrapper */
  container:
    "border-walnut-100 bg-walnut-300 text-paper-200 shadow-lg",
  sectionHeader:
    "border-b border-walnut-100 bg-walnut-400",
  icon: "text-clay-300",
  heading: "text-paper-50",
  muted: "text-paper-400",
  link:
    "text-paper-300 underline-offset-2"
    + " hover:text-paper-50 hover:underline",
  debugButton:
    "h-7 gap-1.5 border border-walnut-100 bg-walnut-200"
    + " px-2.5 font-mono text-[13px] text-paper-300"
    + " hover:bg-walnut-100 hover:text-paper-50",
  sessionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-paper-300",
  sessionTabActive:
    "border-clay-500/50 bg-clay-700/30 text-clay-100 shadow-sm",
  sessionTabInactive:
    "border-walnut-100 bg-walnut-200 text-paper-400"
    + " hover:border-walnut-100"
    + " hover:bg-walnut-100"
    + " hover:text-paper-50",
  panel:
    "overflow-y-auto bg-walnut-300 p-3"
    + " outline-none focus-visible:ring-1"
    + " focus-visible:ring-clay-400/60",
  panelDivider: "border-r border-walnut-100",
  refreshingText: "text-paper-400",
  countText: "text-paper-200",
  /* tab bar */
  tabBar:
    "border-b border-walnut-100 bg-walnut-400",
  tabActive:
    "border-b-2 border-clay-400 text-paper-50",
  tabInactive:
    "text-paper-400 hover:text-paper-200",
  /* session card */
  cardShell:
    "rounded border border-walnut-100 bg-walnut-300 shadow-md",
  cardHeader:
    "border-b border-walnut-100 bg-walnut-400"
    + " px-3 py-2 font-mono text-[14px] leading-6"
    + " text-paper-200 subpixel-antialiased",
  cardText: "text-paper-200",
  cardMuted: "text-paper-400",
  emptySession:
    "rounded border border-walnut-100"
    + " bg-walnut-400 px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-paper-200 subpixel-antialiased",
  highlightRing:
    "rounded ring-2 ring-clay-400/55 shadow-md"
    + " transition-all duration-300",
  /* prompt entry — user role, dark mode */
  promptContainer:
    "rounded border border-walnut-100"
    + " bg-walnut-300 px-3 py-2 shadow-md",
  promptHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-paper-100"
    + " subpixel-antialiased",
  promptDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-paper-300",
  promptBadge:
    "border-walnut-100 bg-walnut-400"
    + " text-[13px] font-normal text-paper-300",
  promptBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-paper-100 subpixel-antialiased",
  promptIcon: "text-paper-300",
  /* response entry — assistant role with clay left rule, dark mode */
  responseContainer:
    "rounded border border-walnut-100 border-l-4 border-l-clay-500"
    + " bg-walnut-200 px-3 py-2 shadow-md",
  responseHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-paper-200"
    + " subpixel-antialiased",
  responseDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-clay-300",
  responseMetaBadge:
    "border-walnut-100 bg-walnut-300"
    + " text-[13px] font-normal text-paper-300",
  responseBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-paper-200 subpixel-antialiased",
  responseIcon: "text-clay-300",
  /* raw event details — tool / system role, dark mode */
  rawContainer:
    "mt-2 rounded border border-walnut-100"
    + " bg-walnut-400 px-2.5 py-2"
    + " text-[14px] font-mono"
    + " text-paper-300 subpixel-antialiased",
  rawSummary: "cursor-pointer text-paper-400",
  rawBody:
    "mt-1.5 whitespace-pre-wrap break-words"
    + " font-mono text-[14px] leading-6"
    + " text-paper-300",
  /* session boundary */
  boundaryRow:
    "rounded border border-walnut-100"
    + " bg-walnut-400 px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-paper-200 subpixel-antialiased",
  /* interaction picker bar */
  pickerBar:
    "flex flex-wrap items-center gap-2"
    + " border-b border-walnut-100 bg-walnut-400"
    + " px-3 py-1.5 font-mono text-[14px]"
    + " text-paper-200 subpixel-antialiased",
  pickerDropdownButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-walnut-100 bg-walnut-200"
    + " px-2.5 py-1 text-[14px] text-paper-200"
    + " hover:bg-walnut-100",
  pickerDropdownPanel:
    "absolute left-0 top-full z-50 mt-1"
    + " max-h-48 w-72 overflow-y-auto rounded"
    + " border border-walnut-100 bg-walnut-300"
    + " shadow-lg",
  pickerOptionDefault: "text-paper-200",
  pickerOptionSelected:
    "bg-clay-700/30 text-clay-100",
  pickerOptionMeta: "text-paper-400",
  pickerNoItems: "text-paper-400",
  pickerSeparator: "text-walnut-100",
  pickerDetailLabel: "text-paper-400",
  pickerDetailSwitch:
    "data-[state=checked]:bg-clay-500"
    + " data-[state=unchecked]:bg-walnut-100",
  pickerCount: "text-paper-400",
  /* filter dropdown */
  filterButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-walnut-100 bg-walnut-200"
    + " px-2.5 py-1 text-[14px] text-paper-200"
    + " hover:bg-walnut-100",
  filterBadgeCount:
    "rounded bg-clay-700/30 px-1.5"
    + " text-[12px] text-clay-100",
  filterPanel:
    "absolute left-0 top-full z-50 mt-1 w-80"
    + " rounded border border-walnut-100"
    + " bg-walnut-300 shadow-lg",
  filterSectionLabel:
    "px-1 text-[13px] uppercase"
    + " tracking-[0.18em] text-paper-400",
  filterLoadingText: "text-paper-400",
  filterOptionHover: "hover:bg-walnut-100",
  filterCheckboxSelected:
    "border-clay-400/70 bg-clay-700/35 text-clay-100",
  filterCheckboxDefault:
    "border-walnut-100 text-transparent",
  filterOptionText: "text-paper-200",
  filterOptionDescription: "text-paper-400",
  filterFooterBar:
    "flex items-center justify-between"
    + " border-t border-walnut-100"
    + " bg-walnut-400 px-2.5 py-1.5",
  filterFooterText: "text-paper-400",
  filterClearButton:
    "text-paper-300 hover:text-paper-50",
  /* dashed / loading messages */
  dashedBorder:
    "border-walnut-100 bg-walnut-300",
  loadingContainer:
    "border-walnut-100 bg-walnut-300 text-paper-200",
  loadingMuted: "text-paper-400",
  /* badge tones */
  badgeInteractionScene:
    "border-clay-500/40 bg-clay-700/25 text-clay-100",
  badgeInteractionDirect:
    "border-moss-500/40 bg-moss-700/25 text-moss-100",
  badgeInteractionDefault:
    "border-lake-500/40 bg-lake-700/25 text-lake-100",
  badgeStatusCompleted:
    "border-moss-500/40 bg-moss-700/25 text-moss-100",
  badgeStatusError:
    "border-rust-500/40 bg-rust-700/25 text-rust-100",
  badgeStatusAborted:
    "border-ochre-500/40 bg-ochre-700/25 text-ochre-100",
  badgeStatusRunning:
    "border-lake-500/40 bg-lake-700/25 text-lake-100",
  badgeStatusDefault:
    "border-walnut-100 bg-walnut-200 text-paper-400",
};
