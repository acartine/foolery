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
    "border-paper-200 bg-[#f8f9fa] text-ink-900"
    + " shadow-[0_12px_32px_rgba(148,163,184,0.16)]",
  sectionHeader:
    "border-b border-paper-200 bg-[#f0f0f0]",
  icon: "text-lake-700",
  heading: "text-ink-900",
  muted: "text-ink-500",
  link:
    "text-ink-600 underline-offset-2"
    + " hover:text-ink-900 hover:underline",
  debugButton:
    "h-7 gap-1.5 border border-paper-300 bg-white"
    + " px-2.5 font-mono text-[13px] text-ink-700"
    + " hover:bg-paper-100 hover:text-ink-900",
  sessionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-ink-600",
  sessionTabActive:
    "border-lake-400 bg-lake-100 text-ink-900"
    + " shadow-[0_0_0_1px_rgba(14,165,233,0.22)]",
  sessionTabInactive:
    "border-paper-300 bg-white text-ink-600"
    + " hover:border-paper-400"
    + " hover:bg-paper-100"
    + " hover:text-ink-900",
  panel:
    "overflow-y-auto bg-[#f8f9fa] p-3"
    + " outline-none focus-visible:ring-1"
    + " focus-visible:ring-sky-500/60",
  panelDivider: "border-r border-paper-200",
  refreshingText: "text-ink-600",
  countText: "text-ink-900",
  /* tab bar */
  tabBar:
    "border-b border-paper-200 bg-[#f0f0f0]",
  tabActive:
    "border-b-2 border-lake-500 text-ink-900",
  tabInactive:
    "text-ink-500 hover:text-ink-700",
  /* session card */
  cardShell:
    "rounded border border-paper-200 bg-white"
    + " shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]",
  cardHeader:
    "border-b border-paper-200 bg-paper-50"
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
    "rounded ring-2 ring-sky-400/70"
    + " shadow-[0_0_0_1px_rgba(14,165,233,0.15)]"
    + " transition-all duration-300",
  /* prompt entry */
  promptContainer:
    "rounded border border-lake-400"
    + " bg-lake-100 px-3 py-2"
    + " shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]",
  promptHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-ink-800"
    + " subpixel-antialiased",
  promptDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-lake-700",
  promptBadge:
    "border-lake-400 bg-lake-100"
    + " text-[13px] font-normal text-lake-700",
  promptBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-ink-800 subpixel-antialiased",
  promptIcon: "text-lake-700",
  /* response entry */
  responseContainer:
    "rounded border border-paper-200"
    + " bg-white px-3 py-2"
    + " shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]",
  responseHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-ink-800"
    + " subpixel-antialiased",
  responseDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-ink-700",
  responseMetaBadge:
    "border-paper-200 bg-paper-100"
    + " text-[13px] font-normal text-ink-700",
  responseBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-ink-800 subpixel-antialiased",
  responseIcon: "text-ink-500",
  /* raw event details */
  rawContainer:
    "mt-2 rounded border border-paper-200"
    + " bg-paper-50 px-2.5 py-2"
    + " text-[14px] font-mono"
    + " text-ink-800 subpixel-antialiased",
  rawSummary: "cursor-pointer text-ink-600",
  rawBody:
    "mt-1.5 whitespace-pre-wrap break-words"
    + " font-mono text-[14px] leading-6"
    + " text-ink-800",
  /* session boundary */
  boundaryRow:
    "rounded border border-paper-200"
    + " bg-paper-50 px-3 py-2"
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
    + " border border-paper-300 bg-white"
    + " px-2.5 py-1 text-[14px] text-ink-700"
    + " hover:bg-paper-100",
  pickerDropdownPanel:
    "absolute left-0 top-full z-50 mt-1"
    + " max-h-48 w-72 overflow-y-auto rounded"
    + " border border-paper-200 bg-white"
    + " shadow-lg",
  pickerOptionDefault: "text-ink-700",
  pickerOptionSelected:
    "bg-lake-100 text-ink-900",
  pickerOptionMeta: "text-ink-500",
  pickerNoItems: "text-ink-500",
  pickerSeparator: "text-paper-300",
  pickerDetailLabel: "text-ink-500",
  pickerDetailSwitch:
    "data-[state=checked]:bg-lake-500"
    + " data-[state=unchecked]:bg-paper-300",
  pickerCount: "text-ink-500",
  /* filter dropdown */
  filterButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-paper-300 bg-white"
    + " px-2.5 py-1 text-[14px] text-ink-700"
    + " hover:bg-paper-100",
  filterBadgeCount:
    "rounded bg-lake-100 px-1.5"
    + " text-[12px] text-lake-700",
  filterPanel:
    "absolute left-0 top-full z-50 mt-1 w-80"
    + " rounded border border-paper-200"
    + " bg-white shadow-lg",
  filterSectionLabel:
    "px-1 text-[13px] uppercase"
    + " tracking-[0.18em] text-paper-400",
  filterLoadingText: "text-ink-500",
  filterOptionHover: "hover:bg-paper-100",
  filterCheckboxSelected:
    "border-lake-400 bg-lake-100 text-lake-700",
  filterCheckboxDefault:
    "border-paper-300 text-transparent",
  filterOptionText: "text-ink-800",
  filterOptionDescription: "text-ink-500",
  filterFooterBar:
    "flex items-center justify-between"
    + " border-t border-paper-200"
    + " bg-paper-50 px-2.5 py-1.5",
  filterFooterText: "text-ink-500",
  filterClearButton:
    "text-ink-600 hover:text-ink-900",
  /* dashed / loading messages */
  dashedBorder:
    "border-paper-300 bg-white",
  loadingContainer:
    "border-paper-300 bg-white text-ink-900",
  loadingMuted: "text-ink-500",
  /* badge tones */
  badgeInteractionScene:
    "border-clay-300 bg-clay-50 text-clay-800",
  badgeInteractionDirect:
    "border-moss-200"
    + " bg-moss-100 text-moss-700",
  badgeInteractionDefault:
    "border-lake-400 bg-lake-100 text-lake-700",
  badgeStatusCompleted:
    "border-moss-200"
    + " bg-moss-100 text-moss-700",
  badgeStatusError:
    "border-rust-400 bg-rust-100 text-rust-700",
  badgeStatusAborted:
    "border-feature-400 bg-feature-100 text-feature-700",
  badgeStatusRunning:
    "border-lake-400 bg-lake-100 text-lake-700",
  badgeStatusDefault:
    "border-paper-200 bg-paper-50 text-ink-600",
};

const DARK: ConversationLogTheme = {
  /* section wrapper */
  container:
    "border-white/10 bg-[#1a1a2e] text-[#e0e0e0]"
    + " shadow-[0_12px_32px_rgba(8,12,24,0.32)]",
  sectionHeader:
    "border-b border-white/10 bg-[#16162a]",
  icon: "text-molecule-100",
  heading: "text-white",
  muted: "text-white/60",
  link:
    "text-white/65 underline-offset-2"
    + " hover:text-white hover:underline",
  debugButton:
    "h-7 gap-1.5 border border-white/10 bg-white/5"
    + " px-2.5 font-mono text-[13px] text-white/80"
    + " hover:bg-white/10 hover:text-white",
  sessionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-white/75",
  sessionTabActive:
    "border-molecule-400/40 bg-molecule-400/12 text-molecule-100"
    + " shadow-[0_0_0_1px_rgba(34,211,238,0.18)]",
  sessionTabInactive:
    "border-white/10 bg-white/5 text-white/70"
    + " hover:border-white/20"
    + " hover:bg-white/10"
    + " hover:text-white",
  panel:
    "overflow-y-auto bg-[#1a1a2e] p-3"
    + " outline-none focus-visible:ring-1"
    + " focus-visible:ring-cyan-500/60",
  panelDivider: "border-r border-white/10",
  refreshingText: "text-white/70",
  countText: "text-[#e0e0e0]",
  /* tab bar */
  tabBar:
    "border-b border-white/10 bg-[#16162a]",
  tabActive:
    "border-b-2 border-molecule-400 text-white",
  tabInactive:
    "text-white/60 hover:text-white/80",
  /* session card */
  cardShell:
    "rounded border border-white/10 bg-[#1a1a2e]"
    + " shadow-[inset_0_1px_0_"
    + "rgba(255,255,255,0.02)]",
  cardHeader:
    "border-b border-white/10 bg-[#16162a]"
    + " px-3 py-2 font-mono text-[14px] leading-6"
    + " text-[#e0e0e0] subpixel-antialiased",
  cardText: "text-[#e0e0e0]",
  cardMuted: "text-white/65",
  emptySession:
    "rounded border border-white/10"
    + " bg-[#16162a] px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-[#e0e0e0] subpixel-antialiased",
  highlightRing:
    "rounded ring-2 ring-cyan-400/70"
    + " shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
    + " transition-all duration-300",
  /* prompt entry */
  promptContainer:
    "rounded border border-molecule-400/25"
    + " bg-[#101522] px-3 py-2"
    + " shadow-[inset_0_1px_0_"
    + "rgba(255,255,255,0.03)]",
  promptHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-[#e0e0e0]"
    + " subpixel-antialiased",
  promptDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-lake-100",
  promptBadge:
    "border-molecule-400/40 bg-molecule-400/10"
    + " text-[13px] font-normal text-lake-100",
  promptBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-[#e0e0e0] subpixel-antialiased",
  promptIcon: "text-lake-100",
  /* response entry */
  responseContainer:
    "rounded border border-white/10"
    + " bg-[#16162a] px-3 py-2"
    + " shadow-[inset_0_1px_0_"
    + "rgba(255,255,255,0.03)]",
  responseHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-[#e0e0e0]"
    + " subpixel-antialiased",
  responseDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-[#e0e0e0]",
  responseMetaBadge:
    "border-white/10 bg-white/5"
    + " text-[13px] font-normal text-[#e0e0e0]",
  responseBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-[#e0e0e0] subpixel-antialiased",
  responseIcon: "text-white/80",
  /* raw event details */
  rawContainer:
    "mt-2 rounded border border-white/10"
    + " bg-[#101522] px-2.5 py-2"
    + " text-[14px] font-mono"
    + " text-[#e0e0e0] subpixel-antialiased",
  rawSummary: "cursor-pointer text-white/75",
  rawBody:
    "mt-1.5 whitespace-pre-wrap break-words"
    + " font-mono text-[14px] leading-6"
    + " text-[#e0e0e0]",
  /* session boundary */
  boundaryRow:
    "rounded border border-white/10"
    + " bg-[#16162a] px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-[#e0e0e0] subpixel-antialiased",
  /* interaction picker bar */
  pickerBar:
    "flex flex-wrap items-center gap-2"
    + " border-b border-white/10 bg-[#16162a]"
    + " px-3 py-1.5 font-mono text-[14px]"
    + " text-[#e0e0e0] subpixel-antialiased",
  pickerDropdownButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-white/10 bg-white/5"
    + " px-2.5 py-1 text-[14px] text-[#e0e0e0]"
    + " hover:bg-white/10",
  pickerDropdownPanel:
    "absolute left-0 top-full z-50 mt-1"
    + " max-h-48 w-72 overflow-y-auto rounded"
    + " border border-white/10 bg-[#1a1a2e]"
    + " shadow-lg",
  pickerOptionDefault: "text-[#e0e0e0]",
  pickerOptionSelected:
    "bg-white/12 text-white",
  pickerOptionMeta: "text-white/60",
  pickerNoItems: "text-white/70",
  pickerSeparator: "text-white/25",
  pickerDetailLabel: "text-white/60",
  pickerDetailSwitch:
    "data-[state=checked]:bg-molecule-700"
    + " data-[state=unchecked]:bg-white/20",
  pickerCount: "text-white/60",
  /* filter dropdown */
  filterButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-white/10 bg-white/5"
    + " px-2.5 py-1 text-[14px] text-[#e0e0e0]"
    + " hover:bg-white/10",
  filterBadgeCount:
    "rounded bg-molecule-400/15 px-1.5"
    + " text-[12px] text-molecule-100",
  filterPanel:
    "absolute left-0 top-full z-50 mt-1 w-80"
    + " rounded border border-white/10"
    + " bg-[#1a1a2e] shadow-lg",
  filterSectionLabel:
    "px-1 text-[13px] uppercase"
    + " tracking-[0.18em] text-white/45",
  filterLoadingText: "text-white/60",
  filterOptionHover: "hover:bg-white/10",
  filterCheckboxSelected:
    "border-molecule-400/60 bg-molecule-400/15"
    + " text-molecule-100",
  filterCheckboxDefault:
    "border-white/20 text-transparent",
  filterOptionText: "text-[#e0e0e0]",
  filterOptionDescription: "text-white/60",
  filterFooterBar:
    "flex items-center justify-between"
    + " border-t border-white/10"
    + " bg-[#16162a] px-2.5 py-1.5",
  filterFooterText: "text-white/60",
  filterClearButton:
    "text-white/75 hover:text-white",
  /* dashed / loading messages */
  dashedBorder:
    "border-white/15 bg-[#16162a]",
  loadingContainer:
    "border-white/15 bg-[#16162a] text-[#e0e0e0]",
  loadingMuted: "text-white/60",
  /* badge tones */
  badgeInteractionScene:
    "border-clay-500/40"
    + " bg-clay-500/20 text-clay-100",
  badgeInteractionDirect:
    "border-moss-500/40"
    + " bg-moss-500/20 text-moss-100",
  badgeInteractionDefault:
    "border-molecule-400/40"
    + " bg-molecule-400/20 text-molecule-100",
  badgeStatusCompleted:
    "border-moss-400/50"
    + " bg-moss-500/20 text-moss-100",
  badgeStatusError:
    "border-rust-400/50"
    + " bg-rust-500/20 text-rust-100",
  badgeStatusAborted:
    "border-feature-400/50"
    + " bg-feature-400/20 text-feature-100",
  badgeStatusRunning:
    "border-lake-400/50"
    + " bg-lake-500/20 text-lake-100",
  badgeStatusDefault:
    "border-white/10 bg-white/5 text-white/70",
};
