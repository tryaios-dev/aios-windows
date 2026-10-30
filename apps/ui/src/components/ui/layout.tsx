import * as React from "react";
import { cn } from "@/lib/cn";

/* ---------------- Section label ---------------- */

export function SectionLabel({ children, className, right }: { children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="label-mono">{children}</span>
      {right && <span className="label-mono">{right}</span>}
    </div>
  );
}

/* ---------------- Kbd ---------------- */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-paper px-1 font-mono text-2xs text-ink-50 shadow-[0_1px_0_var(--color-line)]", className)}>
      {children}
    </kbd>
  );
}

/* ---------------- Mono and copy ---------------- */

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs tracking-[0.02em] text-ink-soft", className)}>{children}</span>;
}

/** Copies text with the Clipboard API and flips `copied` for a moment. */
export function useCopy(timeout = 1600) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(
    (text: string) => {
      navigator.clipboard?.writeText(text).catch(() => undefined);
      setCopied(true);
      window.setTimeout(() => setCopied(false), timeout);
    },
    [timeout],
  );
  return { copied, copy };
}

/* ---------------- Key / value rows ---------------- */

export function KeyValue({ rows, className, dense }: { rows: Array<{ k: React.ReactNode; v: React.ReactNode }>; className?: string; dense?: boolean }) {
  return (
    <dl className={cn("divide-y divide-line-soft", className)}>
      {rows.map((r, i) => (
        <div key={i} className={cn("grid grid-cols-[minmax(120px,36%)_1fr] gap-4", dense ? "py-1.5" : "py-2.5")}>
          <dt className="text-sm text-ink-50">{r.k}</dt>
          <dd className="min-w-0 text-sm text-ink">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Route tabs ---------------- */

export interface RouteTab {
  label: string;
  active: boolean;
  onSelect: () => void;
  count?: number;
}

/** Link-style tab row for route-driven tabs. */
export function RouteTabs({ items, className }: { items: RouteTab[]; className?: string }) {
  return (
    <nav aria-label="Sections" className={cn("flex items-center gap-1", className)}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          aria-current={it.active ? "page" : undefined}
          onClick={it.onSelect}
          className={cn(
            "relative inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm font-medium transition-colors duration-(--duration-micro) hover:text-ink",
            it.active ? "text-ink" : "text-ink-50",
            "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-green after:opacity-0 after:transition-opacity after:duration-(--duration-micro)",
            it.active && "after:opacity-100",
          )}
        >
          {it.label}
          {typeof it.count === "number" && <span className="rounded-sm bg-ink-6 px-1 font-mono text-2xs leading-4 text-ink-50">{it.count}</span>}
        </button>
      ))}
    </nav>
  );
}
