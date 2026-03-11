export type BeatsView =
  | "queues"
  | "active"
  | "search"
  | "finalcut"
  | "retakes"
  | "history";

export function parseBeatsView(viewParam: string | null): BeatsView {
  switch (viewParam) {
    case "active":
    case "search":
    case "finalcut":
    case "retakes":
    case "history":
      return viewParam;
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
