import { ListMusic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function getEmptySetlistState(
  repoPath: string | undefined,
  isLoading: boolean,
  plansOk: boolean | undefined,
  beatsOk: boolean | undefined,
  plansError: string | undefined,
  beatsError: string | undefined,
  planCount: number,
): { title: string; description: string } | null {
  if (!repoPath) {
    return {
      title: "Choose a repo for Setlist",
      description:
        "Setlist needs one active repository so it can load"
        + " persisted execution plans and beat priorities.",
    };
  }
  if (isLoading) {
    return {
      title: "Loading setlist",
      description:
        "Pulling execution plans and beat metadata for the selected repository.",
    };
  }
  if (!plansOk) {
    return {
      title: "Couldn’t load execution plans",
      description:
        plansError ?? "Setlist failed to load plan summaries.",
    };
  }
  if (!beatsOk) {
    return {
      title: "Couldn’t load beat details",
      description:
        beatsError ?? "Setlist failed to load repo beats.",
    };
  }
  if (planCount === 0) {
    return {
      title: "No execution plans yet",
      description:
        "Create an execution plan for this repository and"
        + " it will show up here as a selectable setlist.",
    };
  }
  return null;
}

export function EmptySetlistState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent
        className={
          "flex min-h-[22rem] flex-col items-center"
          + " justify-center gap-3 text-center"
        }
      >
        <Button variant="outline" size="icon" className="pointer-events-none size-11 rounded-full">
          <ListMusic className="size-5" />
        </Button>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            {title}
          </h2>
          <p className="max-w-lg text-sm text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
