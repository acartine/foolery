export type BeatsView =
  | "setlist"
  | "queues"
  | "active"
  | "search"
  | "finalcut"
  | "retakes"
  | "history"
  | "diagnostics";

export function parseBeatsView(viewParam: string | null): BeatsView {
  switch (viewParam) {
    case "setlist":
    case "active":
    case "search":
    case "finalcut":
    case "retakes":
    case "history":
    case "diagnostics":
      return viewParam;
    case "audit":
      return "diagnostics";
    default:
      return "queues";
  }
}

export function isListBeatsView(view: BeatsView): boolean {
  return view === "queues" || view === "active" || view === "search";
}

export function buildBeatsSearchHref(
  searchParams: URLSearchParams | string,
  rawQuery: string,
): string {
  const params = new URLSearchParams(
    typeof searchParams === "string" ? searchParams : searchParams.toString(),
  );
  const query = rawQuery.trim();

  if (query) {
    params.set("q", query);
    params.set("view", "search");
  } else {
    params.delete("q");
    if (params.get("view") === "search") {
      params.delete("view");
    }
  }

  const qs = params.toString();
  return `/beats${qs ? `?${qs}` : ""}`;
}
