import wordmarkBrandDark from "@/assets/brand/aios-wordmark-brand-dark.svg";
import wordmarkIvory from "@/assets/brand/aios-wordmark-ivory.svg";
import wordmarkWhite from "@/assets/brand/aios-wordmark-white.svg";
import { cn } from "@/lib/cn";

/** Imported (not served from /public) so the path resolves under file:// in Electron. */
const WORDMARKS = { "brand-dark": wordmarkBrandDark, ivory: wordmarkIvory, white: wordmarkWhite } as const;

/** The approved A from the wordmark, as an inline SVG so it inherits currentColor. */
export function AMark({ className, title = "AIOS" }: { className?: string | undefined; title?: string | undefined }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label={title}>
      <g transform="translate(64 93.708) scale(1.1)">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M 0.718 294.25 C 0.498 293.837 11.645 268.075 25.491 237 C 39.336 205.925 68.065 141.378 89.333 93.563 C 110.601 45.748 128.987 5.578 130.191 4.296 C 134.106 0.129 137.371 -0.142 179.579 0.187 L 219.659 0.5 L 223.079 3.125 C 225.876 5.27 227.76 8.738 233.403 22.125 C 237.2 31.131 250.313 61.9 262.543 90.5 C 339.143 269.623 349 292.896 349 294.626 C 349 294.832 333.431 295 314.401 295 C 284.988 295 279.305 294.764 276.484 293.425 C 272.865 291.708 273.265 292.519 254.952 249.769 L 246.5 230.038 L 175.462 230.019 L 104.424 230 L 95.519 250.25 C 90.621 261.387 84.537 275.225 81.999 281 C 75.436 295.933 78.527 294.997 35.809 294.998 C 16.729 294.999 0.938 294.663 0.718 294.25 Z M 222.456 171.75 C 221.25 167.75 179.884 71.579 178.318 69.134 C 176.061 65.612 175.306 66.832 164.475 91.5 C 147.769 129.548 132.91 163.301 130.466 168.75 L 128.111 174 L 175.623 174 L 223.135 174 L 222.456 171.75 Z"
        />
      </g>
    </svg>
  );
}

/** The approved in-app placement: the transparent white A on an ink tile. */
export function AppTile({ className, size = 28 }: { className?: string | undefined; size?: number | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[22%] bg-ink text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AMark className="size-[72%]" />
    </span>
  );
}

export function Wordmark({
  className,
  variant = "brand-dark",
  height = 14,
}: {
  className?: string | undefined;
  variant?: "brand-dark" | "white" | "ivory";
  height?: number | undefined;
}) {
  return (
    <img
      src={WORDMARKS[variant]}
      alt="AIOS"
      height={height}
      style={{ height, width: "auto" }}
      className={cn("select-none", className)}
      draggable={false}
    />
  );
}
