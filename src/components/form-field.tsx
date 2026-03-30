import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";

export function FormField({
  label,
  error,
  infoAction,
  children,
}: {
  label: string;
  error?: string;
  infoAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {infoAction && (
          <button
            type="button"
            onClick={infoAction}
            className={
              "text-muted-foreground " +
              "hover:text-foreground transition-colors"
            }
            aria-label={
              `Learn about ${label.toLowerCase()}`
            }
          >
            <Info className="size-3.5" />
          </button>
        )}
      </div>
      {children}
      {error && (
        <p className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
