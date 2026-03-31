"use client";

export interface ConversationLogTheme {
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
}

export function getConversationLogTheme(
  lightTheme: boolean,
): ConversationLogTheme {
  if (lightTheme) {
    return {
      container:
        "border-slate-200 bg-[#f8f9fa] text-slate-900"
        + " shadow-[0_12px_32px_rgba(148,163,184,0.16)]",
      sectionHeader:
        "border-b border-slate-200 bg-[#f0f0f0]",
      icon: "text-sky-700",
      heading: "text-slate-900",
      muted: "text-slate-600",
      link:
        "text-slate-600 underline-offset-2"
        + " hover:text-slate-900 hover:underline",
      debugButton:
        "h-7 gap-1.5 border border-slate-300 bg-white"
        + " px-2.5 font-mono text-[13px] text-slate-700"
        + " hover:bg-slate-100 hover:text-slate-900",
      sessionLabel:
        "font-semibold uppercase tracking-[0.18em] text-slate-600",
      sessionTabActive:
        "border-sky-300 bg-sky-100 text-slate-900"
        + " shadow-[0_0_0_1px_rgba(14,165,233,0.18)]",
      sessionTabInactive:
        "border-slate-300 bg-white text-slate-600"
        + " hover:border-slate-400 hover:bg-slate-100"
        + " hover:text-slate-900",
      panel:
        "overflow-y-auto bg-[#f8f9fa] p-3 outline-none"
        + " focus-visible:ring-1 focus-visible:ring-sky-500/60",
      panelDivider: "border-r border-slate-200",
      refreshingText: "text-slate-600",
      countText: "text-slate-900",
    };
  }

  return {
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
      "font-semibold uppercase tracking-[0.18em] text-white/75",
    sessionTabActive:
      "border-cyan-300/40 bg-cyan-400/12 text-cyan-50"
      + " shadow-[0_0_0_1px_rgba(34,211,238,0.18)]",
    sessionTabInactive:
      "border-white/10 bg-white/5 text-white/70"
      + " hover:border-white/20 hover:bg-white/10"
      + " hover:text-white",
    panel:
      "overflow-y-auto bg-[#1a1a2e] p-3 outline-none"
      + " focus-visible:ring-1 focus-visible:ring-cyan-500/60",
    panelDivider: "border-r border-white/10",
    refreshingText: "text-white/70",
    countText: "text-[#e0e0e0]",
  };
}
