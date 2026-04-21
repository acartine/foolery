// Inlined so the wordmark's "foolery" text inherits `color` from the host
// element (clay in light, paper in dark) while the two paper-cream "eye"
// dots stay fixed at their brand value. Based on
// `Foolery Design System.zip/assets/foolery_wordmark.svg`.

interface FooleryWordmarkProps {
  className?: string;
  "aria-label"?: string;
}

export function FooleryWordmark(
  props: FooleryWordmarkProps,
) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 520 150"
      role="img"
      aria-label={props["aria-label"] ?? "Foolery"}
      className={props.className}
    >
      <text
        x="6"
        y="112"
        fontSize="130"
        fontFamily="var(--font-display)"
        fontWeight="500"
        fill="currentColor"
      >
        foolery
      </text>
      <circle cx="148" cy="74" r="8.5" fill="#f4efe6" />
      <circle cx="222" cy="74" r="8.5" fill="#f4efe6" />
    </svg>
  );
}
