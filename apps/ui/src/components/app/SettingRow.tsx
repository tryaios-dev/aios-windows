import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/fields";
import { useCopy } from "@/components/ui/layout";
import { Tooltip } from "@/components/ui/overlays";

/**
 * The setting-row language shared by Settings and Project settings.
 *
 *   SectionHeader   h2 title, one-line description, hairline
 *   SettingGroup    h3 label-mono caption + a white raised panel of rows
 *   SettingRow      56px row: label in ink, hint in ink-50, control right-aligned
 *   PanelNote       a quiet full-width line inside a panel (notes, lock lines)
 *   Ledger          facts: label-mono captions, mono tabular values
 *   PathValue       a path in mono with a copy affordance
 *   NumberedList    numbered mono steps or limits
 */

/* ---------------- Section header ---------------- */

export function SectionHeader({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <header className={cn("border-b border-line-soft pb-4", className)}>
      <h2 className="text-lg font-semibold leading-6 text-ink">{title}</h2>
      {description && <p className="mt-1 text-sm leading-5 text-ink-soft">{description}</p>}
    </header>
  );
}

/* ---------------- Group and panel ---------------- */

let groupSeq = 0;

export function SettingGroup({
  title,
  description,
  children,
  className,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  children: React.ReactNode;
  className?: string | undefined;
  action?: React.ReactNode | undefined;
}) {
  const [id] = React.useState(() => `setting-group-${++groupSeq}`);
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <h3 id={id} className="label-mono">
            {title}
          </h3>
          {description && <p className="mt-1 text-sm leading-5 text-ink-soft">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** The white raised panel. Direct children are separated by hairlines. */
export function SettingPanel({ children, className }: { children: React.ReactNode; className?: string | undefined }) {
  return (
    <div
      className={cn(
        "divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-white shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------------- Row ---------------- */

export interface SettingRowProps {
  label: React.ReactNode;
  hint?: React.ReactNode | undefined;
  /** Links the label to the control. Without it the label is plain text. */
  htmlFor?: string | undefined;
  /** The control, right-aligned on the label's baseline. */
  control?: React.ReactNode | undefined;
  /** Extra content under the label and control, full width. */
  children?: React.ReactNode | undefined;
  /** Vertical alignment of the control; 'start' for tall controls. */
  align?: "center" | "start";
  className?: string | undefined;
}

export function SettingRow({ label, hint, htmlFor, control, children, align = "center", className }: SettingRowProps) {
  return (
    <div className={cn("flex min-h-14 flex-col justify-center gap-3 px-4 py-3", className)}>
      <div className={cn("flex justify-between gap-6", align === "start" ? "items-start" : "items-center")}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {htmlFor ? (
            <Label htmlFor={htmlFor} className="leading-5">
              {label}
            </Label>
          ) : (
            <div className="text-sm font-medium leading-5 text-ink">{label}</div>
          )}
          {hint && <p className="text-xs leading-4.5 text-ink-50">{hint}</p>}
        </div>
        {control && <div className="flex shrink-0 items-center justify-end gap-2">{control}</div>}
      </div>
      {children}
    </div>
  );
}

/** A quiet line inside a panel: an optional icon and one sentence. */
export function PanelNote({
  icon,
  children,
  tone = "neutral",
  className,
}: {
  icon?: React.ReactNode | undefined;
  children: React.ReactNode;
  tone?: "neutral" | "green" | "caution";
  className?: string | undefined;
}) {
  const iconTone = { neutral: "text-ink-50", green: "text-green", caution: "text-brass" }[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 bg-paper-raised px-4 py-2.5 text-xs leading-4.5",
        tone === "caution" ? "text-brass-text" : "text-ink-soft",
        className,
      )}
    >
      {icon && <span className={cn("mt-px shrink-0 [&>svg]:size-3.5", iconTone)}>{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ---------------- Ledger ---------------- */

export interface LedgerRow {
  k: React.ReactNode;
  v: React.ReactNode;
  /** One line under the value. */
  hint?: React.ReactNode | undefined;
  /** Set the value in mono with tabular figures. */
  mono?: boolean | undefined;
  /** Render the key as given (a path, a name) instead of as a label-mono caption. */
  rawKey?: boolean | undefined;
}

export function Ledger({
  rows,
  className,
  dense,
  cols = "grid-cols-[minmax(132px,34%)_1fr]",
}: {
  rows: LedgerRow[];
  className?: string | undefined;
  dense?: boolean | undefined;
  /** Tailwind grid-cols class for the key and value columns. */ cols?: string | undefined;
}) {
  return (
    <dl className={cn("divide-y divide-line-soft", className)}>
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn("grid items-baseline gap-x-6 px-4", cols, dense ? "min-h-10 py-2" : "min-h-11 py-2.5")}
        >
          <dt className={cn(r.rawKey ? "min-w-0 text-sm font-medium leading-5 text-ink" : "label-mono truncate pt-px")}>
            {r.k}
          </dt>
          <dd className="min-w-0">
            <div className={cn("text-sm leading-5 text-ink", r.mono && "font-mono text-xs tracking-[0.02em] tabular")}>
              {r.v}
            </div>
            {r.hint && <div className="mt-0.5 text-xs leading-4.5 text-ink-50">{r.hint}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Path with copy ---------------- */

export function PathValue({
  value,
  copyValue = value,
  className,
}: {
  value: string;
  /** What the copy puts on the clipboard; defaults to the shown value. */ copyValue?: string | undefined;
  className?: string | undefined;
}) {
  const { copied, copy } = useCopy();
  return (
    <Tooltip content={copied ? "Copied" : "Copy path"}>
      <button
        type="button"
        onClick={() => copy(copyValue)}
        aria-label={`Copy ${copyValue}`}
        className={cn(
          "group inline-flex max-w-full items-center gap-1.5 rounded-xs text-left font-mono text-xs tracking-[0.02em] text-ink hover:text-green",
          className,
        )}
      >
        <span className="break-all">{value}</span>
        {copied ? (
          <Check className="size-3 shrink-0 text-green" aria-hidden />
        ) : (
          <Copy
            className="size-3 shrink-0 text-ink-50 opacity-0 transition-opacity duration-(--duration-micro) group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        )}
      </button>
    </Tooltip>
  );
}

/* ---------------- Numbered list ---------------- */

export function NumberedList({
  items,
  className,
}: {
  items: Array<{ title: React.ReactNode; text?: React.ReactNode | undefined }>;
  className?: string | undefined;
}) {
  return (
    <ol className={cn("divide-y divide-line-soft", className)}>
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[2rem_1fr] gap-x-4 px-4 py-3">
          <span className="pt-0.5 font-mono text-xs leading-4.5 text-ink-50 tabular" aria-hidden>
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium leading-5 text-ink">{it.title}</div>
            {it.text && <div className="mt-0.5 text-sm leading-5 text-ink-soft">{it.text}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
