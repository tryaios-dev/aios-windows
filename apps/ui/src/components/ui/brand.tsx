import wordmarkBrandDark from "@/assets/brand/aios-wordmark-brand-dark.svg";
import wordmarkIvory from "@/assets/brand/aios-wordmark-ivory.svg";
import wordmarkWhite from "@/assets/brand/aios-wordmark-white.svg";
import { cn } from "@/lib/cn";

/** Imported (not served from /public) so the path resolves under file:// in Electron. */
const WORDMARKS = { "brand-dark": wordmarkBrandDark, ivory: wordmarkIvory, white: wordmarkWhite } as const;

export function Wordmark({ className, variant = "brand-dark", height = 14 }: { className?: string; variant?: keyof typeof WORDMARKS; height?: number }) {
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
