import type * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE } from "@/lib/motion";
import { Wordmark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";

/**
 * Full-screen stage for the first-run wizard. Warm paper with a faint grain,
 * the wordmark alone top-left, a quiet step rail on the left (a top progress
 * line below 1024px), and a content column (max 640px) that each step fills
 * with <StepBody> and <StepFooter>.
 */

export type RailState = "done" | "current" | "todo" | "skipped";

export interface RailStep {
  id: string;
  label: string;
  state: RailState;
}

/** Height of one rail row in px; the progress line is measured against it. */
const RAIL_ROW = 44;

export function SetupFrame({ steps, current = 0, eyebrow, children }: { steps?: RailStep[]; current?: number; eyebrow?: React.ReactNode; children: React.ReactNode }) {
  const total = steps?.length ?? 0;
  const currentLabel = steps?.[current]?.label;
  const topPct = total ? ((current + 1) / total) * 100 : 0;

  return (
    <div className="grain flex h-full w-full flex-col bg-paper text-ink">
      <header className="relative flex h-14 shrink-0 items-center justify-between px-6 sm:px-8">
        <Wordmark height={15} />
        {steps ? (
          <div className="label-mono tabular lg:hidden" aria-live="polite">
            Step {current + 1} of {total}
            {currentLabel && <span className="hidden sm:inline"> · {currentLabel}</span>}
          </div>
        ) : (
          eyebrow && <div className="label-mono">{eyebrow}</div>
        )}
        {steps && (
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-line-soft lg:hidden">
            <motion.div className="h-px bg-green" initial={false} animate={{ width: `${topPct}%` }} transition={{ duration: 0.28, ease: EASE }} />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {steps && (
          <nav aria-label="Setup steps" className="hidden w-[264px] shrink-0 pl-8 pr-6 pt-14 lg:block">
            <div className="label-mono tabular mb-6">
              Step {current + 1} of {total}
            </div>
            <div className="relative">
              <span aria-hidden className="absolute left-0 top-0 h-full w-px bg-line" />
              <motion.span
                aria-hidden
                className="absolute left-0 top-0 w-px bg-green"
                initial={false}
                animate={{ height: current * RAIL_ROW + RAIL_ROW / 2 }}
                transition={{ duration: 0.28, ease: EASE }}
              />
              <motion.span
                aria-hidden
                className="absolute -left-[2px] size-[5px] rounded-full bg-green"
                initial={false}
                animate={{ top: current * RAIL_ROW + RAIL_ROW / 2 - 2.5 }}
                transition={{ duration: 0.28, ease: EASE }}
              />
              <ol className="flex flex-col">
                {steps.map((s, i) => (
                  <RailRow key={s.id} step={s} index={i} />
                ))}
              </ol>
            </div>
          </nav>
        )}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

function RailRow({ step, index }: { step: RailStep; index: number }) {
  const { state } = step;
  return (
    <li aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-3 pl-6" style={{ height: RAIL_ROW }}>
      <span className={cn("flex w-5 shrink-0 items-center font-mono text-2xs tabular", state === "current" ? "font-medium text-green" : state === "done" ? "text-green" : "text-ink-50")}>
        {state === "done" ? <DrawnCheck className="size-3.5" label="Done" /> : String(index + 1).padStart(2, "0")}
      </span>
      <span className={cn("truncate text-sm transition-colors duration-(--duration-micro)", state === "current" ? "font-medium text-ink" : state === "done" ? "text-ink-soft" : "text-ink-50")}>
        {step.label}
      </span>
      {state === "skipped" && <span className="font-mono text-2xs text-ink-50">skipped</span>}
    </li>
  );
}

/* ---------------- Marks ---------------- */

/** A check mark whose stroke is drawn in over ~280ms. Collapses to a fade under reduced motion. */
export function DrawnCheck({ className, label, strokeWidth = 2.5 }: { className?: string; label?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 12 12" className={cn("shrink-0 overflow-visible", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <motion.path
        d="M2.25 6.4 L4.9 9 L9.75 3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ pathLength: { duration: 0.28, ease: EASE }, opacity: { duration: 0.08 } }}
      />
    </svg>
  );
}

/* ---------------- Content column pieces ---------------- */

export function StepBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto w-full max-w-[640px] px-6 pb-12 pt-10 sm:px-8 lg:pt-14", className)}>{children}</div>
    </div>
  );
}

export function StepHeading({ eyebrow, title, lede, rule, className }: { eyebrow?: React.ReactNode; title: React.ReactNode; lede?: React.ReactNode; rule?: boolean; className?: string }) {
  return (
    <header className={cn("mb-8", className)}>
      {eyebrow && <div className="label-mono mb-4">{eyebrow}</div>}
      <h1 className="font-display text-[36px] leading-[1.1] text-ink lg:text-[40px]">{title}</h1>
      {rule && <span aria-hidden className="mt-6 block h-0.5 w-10 bg-green" />}
      {lede && <p className="mt-4 max-w-[56ch] text-md leading-6 text-ink-soft">{lede}</p>}
    </header>
  );
}

/** A raised white card with a hairline border; the content block of every step. */
export function Plate({
  children,
  className,
  tone = "white",
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string | undefined;
  tone?: "white" | "paper" | "success";
  as?: "div" | "section";
  "aria-label"?: string;
}) {
  return (
    <Tag
      {...rest}
      className={cn(
        "rounded-lg border p-5 sm:p-6",
        tone === "white" && "border-line bg-white shadow-card",
        tone === "paper" && "border-line bg-paper-raised",
        tone === "success" && "border-green/25 bg-green-wash",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export interface FooterPrimary {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Hide the trailing arrow (for final actions such as "Open AIOS"). */
  arrow?: boolean;
}

export function StepFooter({ onBack, backLabel = "Back", note, secondary, primary }: { onBack?: () => void; backLabel?: string; note?: React.ReactNode; secondary?: React.ReactNode; primary?: FooterPrimary }) {
  return (
    <div className="shrink-0 border-t border-line-soft bg-paper/90 backdrop-blur-[2px]">
      <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-3 px-6 py-4 sm:px-8">
        <div className="min-w-0">
          {onBack ? (
            <Button variant="ghost" leading={<ArrowLeft className="size-3.5" />} onClick={onBack} className="-ml-2.5">
              {backLabel}
            </Button>
          ) : (
            note && <span className="block text-xs leading-4.5 text-ink-50">{note}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {secondary}
          {primary && (
            <Button
              variant="primary"
              size="lg"
              onClick={primary.onClick}
              disabled={primary.disabled}
              loading={primary.loading}
              trailing={primary.arrow === false || primary.loading ? undefined : <ArrowRight className="size-3.5" />}
            >
              {primary.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Timed sequences (driven by useSequence) ---------------- */

export interface SequenceItem {
  label: React.ReactNode;
  /** Shown in the mono register once the row is done. */
  detail?: React.ReactNode;
}

type RowState = "done" | "current" | "todo" | "failed";

/**
 * A ledger of timed rows: hairline-divided, a stroke-drawn check as each one
 * completes, the detail set in mono on the right. Rows reveal with a 40ms
 * stagger on first render.
 */
export function Sequence({ items, done, failedAt, className, label }: { items: SequenceItem[]; done: number; failedAt?: number | null; className?: string; label?: string }) {
  return (
    <ol className={cn("flex flex-col divide-y divide-line-soft", className)} role="status" aria-live="polite" aria-label={label}>
      {items.map((it, i) => {
        const state: RowState = failedAt === i ? "failed" : i < done ? "done" : i === done && failedAt == null ? "current" : "todo";
        return (
          <motion.li key={i} className="flex items-start gap-3 py-3" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE, delay: i * 0.04 }}>
            <span
              className={cn(
                "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-(--duration-micro)",
                state === "done" && "border-green bg-green text-white",
                state === "failed" && "border-deny bg-deny text-white",
                state === "current" && "border-green/40 bg-white",
                state === "todo" && "border-line bg-paper-raised",
              )}
              aria-hidden
            >
              {state === "done" && <DrawnCheck className="size-2.5" strokeWidth={2.75} />}
              {state === "failed" && <X className="size-2.5 animate-in" strokeWidth={3} />}
              {state === "current" && <Loader2 className="size-2.5 animate-spin text-green" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <span
                className={cn(
                  "text-sm leading-5 transition-colors duration-(--duration-micro)",
                  state === "todo" ? "text-ink-50" : state === "failed" ? "font-medium text-deny" : state === "current" ? "font-medium text-ink" : "text-ink",
                )}
              >
                {it.label}
                <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (in progress)" : state === "failed" ? " (failed)" : ""}</span>
              </span>
              <AnimatePresence initial={false}>
                {it.detail && state === "done" && (
                  <motion.span
                    key="detail"
                    className="min-w-0 break-all font-mono text-xs leading-4.5 tabular text-ink-50 sm:max-w-[52%] sm:shrink-0 sm:text-right"
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    {it.detail}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

/* ---------------- Figures ---------------- */

export function Stat({ label, value, unit, hint }: { label: React.ReactNode; value: React.ReactNode; unit?: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-card">
      <div className="label-mono">{label}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-4xl leading-none tabular text-ink">{value}</span>
        {unit && <span className="font-mono text-sm text-ink-50">{unit}</span>}
      </div>
      {hint && <div className="mt-3 text-xs leading-4.5 text-ink-50">{hint}</div>}
    </div>
  );
}

/** A determinate progress bar drawn as segments; the live segment fills continuously. */
export function SegmentedProgress({ value, tone = "green", segments = 24, label, className }: { value: number; tone?: "green" | "brass" | "deny"; segments?: number; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const filled = (pct / 100) * segments;
  const bar = { green: "bg-green", brass: "bg-brass", deny: "bg-deny" }[tone];
  return (
    <div className={cn("flex h-2 w-full gap-[3px]", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      {Array.from({ length: segments }, (_, i) => {
        const fill = Math.max(0, Math.min(1, filled - i));
        return (
          <span key={i} className="relative h-full min-w-0 flex-1 overflow-hidden rounded-[2px] bg-ink-12">
            <span className={cn("absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-300 ease-(--ease-out)", bar)} style={{ width: `${fill * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}

/** Fades a block in from 4px below; used for panels that swap in place. */
export function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.24, ease: EASE }}>
      {children}
    </motion.div>
  );
}
