import * as React from "react";
import { Tabs as RTabs } from "radix-ui";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { shortHash } from "@/lib/hash";
import { Tooltip } from "./overlays";

/* ---------------- Card ---------------- */

export function Card({
  className,
  children,
  padded = true,
  raised,
}: {
  className?: string | undefined;
  children: React.ReactNode;
  padded?: boolean | undefined;
  raised?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-paper-raised",
        raised && "bg-white shadow-card",
        padded && "p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  action?: React.ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-sm leading-5 text-ink-soft">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------------- Section label ---------------- */

export function SectionLabel({
  children,
  className,
  right,
}: {
  children: React.ReactNode;
  className?: string | undefined;
  right?: React.ReactNode | undefined;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="label-mono">{children}</span>
      {right && <span className="label-mono">{right}</span>}
    </div>
  );
}

/* ---------------- Separator ---------------- */

export function Separator({ className, vertical }: { className?: string | undefined; vertical?: boolean | undefined }) {
  return (
    <div
      role="separator"
      className={cn(vertical ? "h-full w-px self-stretch bg-line-soft" : "h-px w-full bg-line-soft", className)}
    />
  );
}

/* ---------------- Kbd ---------------- */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string | undefined }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-paper px-1 font-mono text-2xs text-ink-50 shadow-[0_1px_0_var(--color-line)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ---------------- Mono / hash ---------------- */

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

export function Hash({
  value,
  head = 8,
  tail = 6,
  className,
  copyable = true,
  full,
}: {
  value: string;
  head?: number | undefined;
  tail?: number | undefined;
  className?: string | undefined;
  copyable?: boolean | undefined;
  full?: boolean | undefined;
}) {
  const { copied, copy } = useCopy();
  const shown = full ? value : shortHash(value, head, tail);
  const inner = (
    <span className={cn("font-mono text-xs tracking-[0.02em] text-ink-soft", full && "break-all", className)}>
      {shown}
    </span>
  );
  if (!copyable) return inner;
  return (
    <Tooltip content={copied ? "Copied" : "Copy full value"}>
      <button
        type="button"
        onClick={() => copy(value)}
        className="group inline-flex max-w-full items-center gap-1.5 rounded-xs text-left hover:text-ink"
        aria-label="Copy full value"
      >
        {inner}
        {copied ? (
          <Check className="size-3 shrink-0 text-green" />
        ) : (
          <Copy className="size-3 shrink-0 text-ink-50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        )}
      </button>
    </Tooltip>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string | undefined }) {
  return <span className={cn("font-mono text-xs tracking-[0.02em] text-ink-soft", className)}>{children}</span>;
}

/* ---------------- Key / value rows ---------------- */

export function KeyValue({
  rows,
  className,
  dense,
}: {
  rows: Array<{ k: React.ReactNode; v: React.ReactNode; hint?: React.ReactNode | undefined }>;
  className?: string | undefined;
  dense?: boolean | undefined;
}) {
  return (
    <dl className={cn("divide-y divide-line-soft", className)}>
      {rows.map((r, i) => (
        <div key={i} className={cn("grid grid-cols-[minmax(120px,36%)_1fr] gap-4", dense ? "py-1.5" : "py-2.5")}>
          <dt className="text-sm text-ink-50">
            {r.k}
            {r.hint && <div className="text-xs text-ink-50">{r.hint}</div>}
          </dt>
          <dd className="min-w-0 text-sm text-ink">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Tabs ---------------- */

export const Tabs = RTabs.Root;
export const TabsContent = RTabs.Content;

export function TabsList({ className, children, ...props }: React.ComponentProps<typeof RTabs.List>) {
  return (
    <RTabs.List className={cn("flex items-center gap-1", className)} {...props}>
      {children}
    </RTabs.List>
  );
}

export function TabsTrigger({
  className,
  children,
  count,
  ...props
}: React.ComponentProps<typeof RTabs.Trigger> & { count?: number | undefined }) {
  return (
    <RTabs.Trigger
      className={cn(
        "relative inline-flex h-9 items-center gap-1.5 px-2 text-sm font-medium text-ink-50 transition-colors duration-(--duration-micro) hover:text-ink data-[state=active]:text-ink",
        "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-green after:opacity-0 after:transition-opacity after:duration-(--duration-micro) data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
      {typeof count === "number" && (
        <span className="rounded-sm bg-ink-6 px-1 font-mono text-2xs leading-4 text-ink-50">{count}</span>
      )}
    </RTabs.Trigger>
  );
}

/** Link-style tab row for route-driven tabs. */
export function RouteTabs({
  items,
  className,
}: {
  items: Array<{ label: string; active: boolean; onSelect: () => void; count?: number | undefined }>;
  className?: string | undefined;
}) {
  return (
    <nav aria-label="Sections" className={cn("flex items-center gap-1", className)}>
      {items.map((it) => (
        <button
          key={it.label}
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
          {typeof it.count === "number" && (
            <span className="rounded-sm bg-ink-6 px-1 font-mono text-2xs leading-4 text-ink-50">{it.count}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

/* ---------------- Page scaffolding for global screens ---------------- */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  actions?: React.ReactNode | undefined;
  eyebrow?: React.ReactNode | undefined;
  className?: string | undefined;
  children?: React.ReactNode | undefined;
}) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-line-soft bg-paper px-6 pt-5 pb-0", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="label-mono mb-1">{eyebrow}</div>}
          <h1 className="text-xl font-semibold leading-7 text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-soft">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children ? <div className="-mb-px">{children}</div> : <div className="h-3" />}
    </div>
  );
}

export function PageBody({
  children,
  className,
  width = "max-w-3xl",
}: {
  children: React.ReactNode;
  className?: string | undefined;
  width?: string | undefined;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto w-full px-6 py-6", width, className)}>{children}</div>
    </div>
  );
}
