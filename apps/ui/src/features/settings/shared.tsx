import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { StatusDot, type DotTone } from "@/components/ui/chips";

const statusTone: Record<DotTone, string> = {
  green: "text-ink-soft",
  brass: "text-brass-text",
  deny: "text-deny",
  neutral: "text-ink-50",
  ink: "text-ink",
};

/**
 * One component in a status list: dot, name, state word, one line of detail,
 * an optional figure on the right and optional extras underneath.
 */
export function ComponentRow({
  tone,
  pulse,
  name,
  status,
  detail,
  figure,
  children,
  as = "li",
}: {
  tone: DotTone;
  pulse?: boolean | undefined;
  name: string;
  status: string;
  detail?: ReactNode | undefined;
  figure?: ReactNode | undefined;
  children?: ReactNode | undefined;
  as?: "li" | "div";
}) {
  const Tag = as;
  return (
    <Tag className="flex min-h-14 items-start gap-3 px-4 py-3">
      <StatusDot tone={tone} pulse={pulse} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium leading-5 text-ink">{name}</span>
            <span className={cn("text-sm leading-5", statusTone[tone])}>{status}</span>
          </span>
          {figure && <span className="shrink-0 font-mono text-xs tabular text-ink-soft">{figure}</span>}
        </div>
        {detail && <div className="mt-0.5 text-xs leading-4.5 text-ink-50">{detail}</div>}
        {children}
      </div>
    </Tag>
  );
}
