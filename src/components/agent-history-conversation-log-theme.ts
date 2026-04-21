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
    "border-slate-200 bg-[#f8f9fa] text-slate-900"
    + " shadow-[0_12px_32px_rgba(148,163,184,0.16)]",
  sectionHeader:
    "border-b border-slate-200 bg-[#f0f0f0]",
  icon: "text-sky-700",
  heading: "text-slate-900",
  muted: "text-slate-500",
  link:
    "text-slate-600 underline-offset-2"
    + " hover:text-slate-900 hover:underline",
  debugButton:
    "h-7 gap-1.5 border border-slate-300 bg-white"
    + " px-2.5 font-mono text-[13px] text-slate-700"
    + " hover:bg-slate-100 hover:text-slate-900",
  sessionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-slate-600",
  sessionTabActive:
    "border-sky-400 bg-sky-100 text-slate-900"
    + " shadow-[0_0_0_1px_rgba(14,165,233,0.22)]",
  sessionTabInactive:
    "border-slate-300 bg-white text-slate-600"
    + " hover:border-slate-400"
    + " hover:bg-slate-100"
    + " hover:text-slate-900",
  panel:
    "overflow-y-auto bg-[#f8f9fa] p-3"
    + " outline-none focus-visible:ring-1"
    + " focus-visible:ring-sky-500/60",
  panelDivider: "border-r border-slate-200",
  refreshingText: "text-slate-600",
  countText: "text-slate-900",
  /* tab bar */
  tabBar:
    "border-b border-slate-200 bg-[#f0f0f0]",
  tabActive:
    "border-b-2 border-sky-500 text-slate-900",
  tabInactive:
    "text-slate-500 hover:text-slate-700",
  /* session card */
  cardShell:
    "rounded border border-slate-200 bg-white"
    + " shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]",
  cardHeader:
    "border-b border-slate-200 bg-slate-50"
    + " px-3 py-2 font-mono text-[14px] leading-6"
    + " text-slate-800 subpixel-antialiased",
  cardText: "text-slate-800",
  cardMuted: "text-slate-500",
  emptySession:
    "rounded border border-slate-200"
    + " bg-slate-50 px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-slate-700 subpixel-antialiased",
  highlightRing:
    "rounded ring-2 ring-sky-400/70"
    + " shadow-[0_0_0_1px_rgba(14,165,233,0.15)]"
    + " transition-all duration-300",
  /* prompt entry */
  promptContainer:
    "rounded border border-sky-300"
    + " bg-sky-50 px-3 py-2"
    + " shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]",
  promptHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-slate-800"
    + " subpixel-antialiased",
  promptDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-sky-800",
  promptBadge:
    "border-sky-300 bg-sky-100"
    + " text-[13px] font-normal text-sky-800",
  promptBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-slate-800 subpixel-antialiased",
  promptIcon: "text-sky-700",
  /* response entry */
  responseContainer:
    "rounded border border-slate-200"
    + " bg-white px-3 py-2"
    + " shadow-[inset_0_1px_0_rgba(0,0,0,0.02)]",
  responseHeader:
    "mb-1.5 flex flex-wrap items-center"
    + " gap-2 font-mono text-[14px]"
    + " leading-6 text-slate-800"
    + " subpixel-antialiased",
  responseDirectionLabel:
    "font-semibold uppercase"
    + " tracking-[0.18em] text-slate-700",
  responseMetaBadge:
    "border-slate-200 bg-slate-100"
    + " text-[13px] font-normal text-slate-700",
  responseBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-slate-800 subpixel-antialiased",
  responseIcon: "text-slate-500",
  /* raw event details */
  rawContainer:
    "mt-2 rounded border border-slate-200"
    + " bg-slate-50 px-2.5 py-2"
    + " text-[14px] font-mono"
    + " text-slate-800 subpixel-antialiased",
  rawSummary: "cursor-pointer text-slate-600",
  rawBody:
    "mt-1.5 whitespace-pre-wrap break-words"
    + " font-mono text-[14px] leading-6"
    + " text-slate-800",
  /* session boundary */
  boundaryRow:
    "rounded border border-slate-200"
    + " bg-slate-50 px-3 py-2"
    + " font-mono text-[15px] leading-6"
    + " text-slate-700 subpixel-antialiased",
  /* interaction picker bar */
  pickerBar:
    "flex flex-wrap items-center gap-2"
    + " border-b border-slate-200 bg-slate-50"
    + " px-3 py-1.5 font-mono text-[14px]"
    + " text-slate-800 subpixel-antialiased",
  pickerDropdownButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-slate-300 bg-white"
    + " px-2.5 py-1 text-[14px] text-slate-700"
    + " hover:bg-slate-100",
  pickerDropdownPanel:
    "absolute left-0 top-full z-50 mt-1"
    + " max-h-48 w-72 overflow-y-auto rounded"
    + " border border-slate-200 bg-white"
    + " shadow-lg",
  pickerOptionDefault: "text-slate-700",
  pickerOptionSelected:
    "bg-sky-50 text-slate-900",
  pickerOptionMeta: "text-slate-500",
  pickerNoItems: "text-slate-500",
  pickerSeparator: "text-slate-300",
  pickerDetailLabel: "text-slate-500",
  pickerDetailSwitch:
    "data-[state=checked]:bg-sky-500"
    + " data-[state=unchecked]:bg-slate-300",
  pickerCount: "text-slate-500",
  /* filter dropdown */
  filterButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-slate-300 bg-white"
    + " px-2.5 py-1 text-[14px] text-slate-700"
    + " hover:bg-slate-100",
  filterBadgeCount:
    "rounded bg-sky-100 px-1.5"
    + " text-[12px] text-sky-800",
  filterPanel:
    "absolute left-0 top-full z-50 mt-1 w-80"
    + " rounded border border-slate-200"
    + " bg-white shadow-lg",
  filterSectionLabel:
    "px-1 text-[13px] uppercase"
    + " tracking-[0.18em] text-slate-400",
  filterLoadingText: "text-slate-500",
  filterOptionHover: "hover:bg-slate-100",
  filterCheckboxSelected:
    "border-sky-400 bg-sky-100 text-sky-700",
  filterCheckboxDefault:
    "border-slate-300 text-transparent",
  filterOptionText: "text-slate-800",
  filterOptionDescription: "text-slate-500",
  filterFooterBar:
    "flex items-center justify-between"
    + " border-t border-slate-200"
    + " bg-slate-50 px-2.5 py-1.5",
  filterFooterText: "text-slate-500",
  filterClearButton:
    "text-slate-600 hover:text-slate-900",
  /* dashed / loading messages */
  dashedBorder:
    "border-slate-300 bg-white",
  loadingContainer:
    "border-slate-300 bg-white text-slate-900",
  loadingMuted: "text-slate-500",
  /* badge tones */
  badgeInteractionScene:
    "border-violet-300 bg-violet-50 text-violet-800",
  badgeInteractionDirect:
    "border-emerald-300"
    + " bg-emerald-50 text-emerald-800",
  badgeInteractionDefault:
    "border-sky-300 bg-sky-50 text-sky-800",
  badgeStatusCompleted:
    "border-emerald-300"
    + " bg-emerald-50 text-emerald-800",
  badgeStatusError:
    "border-red-300 bg-red-50 text-red-800",
  badgeStatusAborted:
    "border-amber-300 bg-amber-50 text-amber-800",
  badgeStatusRunning:
    "border-sky-300 bg-sky-50 text-sky-800",
  badgeStatusDefault:
    "border-slate-200 bg-slate-50 text-slate-600",
};

const DARK: ConversationLogTheme = {
  /* section wrapper */
  container:
    "border-white/10 bg-[#1a1a2e] text-[#e0e0e0]"
    + " shadow-[0_12px_32px_rgba(8,12,24,0.32)]",
  sectionHeader:
    "border-b border-white/10 bg-[#16162a]",
  icon: "text-cyan-200",
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
    "border-cyan-300/40 bg-cyan-400/12 text-cyan-50"
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
    "border-b-2 border-cyan-400 text-white",
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
    "rounded border border-cyan-400/25"
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
    + " tracking-[0.18em] text-sky-100",
  promptBadge:
    "border-cyan-300/40 bg-cyan-400/10"
    + " text-[13px] font-normal text-sky-100",
  promptBody:
    "whitespace-pre-wrap break-words"
    + " font-mono text-[15px] leading-7"
    + " text-[#e0e0e0] subpixel-antialiased",
  promptIcon: "text-sky-100",
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
    "data-[state=checked]:bg-cyan-600"
    + " data-[state=unchecked]:bg-white/20",
  pickerCount: "text-white/60",
  /* filter dropdown */
  filterButton:
    "inline-flex items-center gap-1.5 rounded"
    + " border border-white/10 bg-white/5"
    + " px-2.5 py-1 text-[14px] text-[#e0e0e0]"
    + " hover:bg-white/10",
  filterBadgeCount:
    "rounded bg-cyan-400/15 px-1.5"
    + " text-[12px] text-cyan-50",
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
    "border-cyan-300/60 bg-cyan-400/15"
    + " text-cyan-100",
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
    "border-violet-500/40"
    + " bg-violet-500/20 text-violet-100",
  badgeInteractionDirect:
    "border-emerald-500/40"
    + " bg-emerald-500/20 text-emerald-100",
  badgeInteractionDefault:
    "border-cyan-500/40"
    + " bg-cyan-500/20 text-cyan-100",
  badgeStatusCompleted:
    "border-emerald-400/50"
    + " bg-emerald-500/20 text-emerald-100",
  badgeStatusError:
    "border-red-400/50"
    + " bg-red-500/20 text-red-100",
  badgeStatusAborted:
    "border-amber-400/50"
    + " bg-amber-500/20 text-amber-100",
  badgeStatusRunning:
    "border-sky-400/50"
    + " bg-sky-500/20 text-sky-100",
  badgeStatusDefault:
    "border-white/10 bg-white/5 text-white/70",
};
