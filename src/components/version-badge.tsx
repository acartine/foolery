"use client";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/**
 * A cinematic version badge that sits beside the app logo.
 *
 * Uses IBM Plex Mono (font-mono) for a code-feel aesthetic,
 * with an animated gradient border shimmer on hover -- like
 * a film reel frame counter ticking over.
 */
export function VersionBadge() {
  return (
    <span
      className="version-badge group relative inline-flex cursor-default select-none items-center"
      title={`Foolery v${APP_VERSION}`}
    >
      {/* Animated gradient border layer */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-md bg-[length:200%_200%] bg-[linear-gradient(135deg,transparent_30%,oklch(0.65_0.15_250)_45%,oklch(0.7_0.18_300)_55%,transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:animate-[shimmer_2s_ease-in-out_infinite]"
      />

      {/* Inner content with its own background to create a "border" effect */}
      <span className="relative z-10 inline-flex items-center gap-1 rounded-[5px] bg-muted/60 px-1.5 py-0.5 ring-1 ring-border/50 transition-all duration-300 group-hover:bg-muted/80 group-hover:ring-transparent">
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_oklch(0.7_0.2_160)] transition-shadow duration-300 group-hover:shadow-[0_0_8px_oklch(0.7_0.2_160)]"
        />
        <span className="font-mono text-[10px] font-medium leading-none tracking-wider text-muted-foreground transition-colors duration-300 group-hover:text-foreground">
          v{APP_VERSION}
        </span>
      </span>
    </span>
  );
}
