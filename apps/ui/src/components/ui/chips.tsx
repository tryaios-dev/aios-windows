import * as React from "react";
import { Building2, Globe, Lock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Classification } from "@/lib/types";

/* ---------------- Badge ---------------- */

export type BadgeTone = "neutral" | "green" | "brass" | "deny" | "slate" | "ink";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-paper-deep text-ink-soft border-transparent",
  green: "bg-green-tint text-green-dark border-transparent",
  brass: "bg-brass-tint text-brass-text border-transparent",
  deny: "bg-deny-tint text-deny border-transparent",
  slate: "bg-slate-tint text-slate border-transparent",
  ink: "bg-ink text-paper border-transparent",
};

export function Badge({ tone = "neutral", className, children, mono, icon }: { tone?: BadgeTone; className?: string; children: React.ReactNode; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium leading-none whitespace-nowrap", mono && "font-mono tracking-wide", tones[tone], className)}>
      {icon && <span className="[&>svg]:size-3">{icon}</span>}
      {children}
    </span>
  );
}

/* ---------------- Classification chip ---------------- */

export const CLASS_META: Record<Classification, { label: string; icon: LucideIcon; summary: string }> = {
  restricted: { label: "Restricted", icon: Lock, summary: "Stays on this device. The safest setting and the default." },
  internal: { label: "Internal", icon: Building2, summary: "Meant for people inside your organisation." },
  public: { label: "Public", icon: Globe, summary: "Nothing confidential." },
};

export function ClassChip({ value, size = "sm", className, labelled = true }: { value: Classification; size?: "xs" | "sm" | "md"; className?: string; labelled?: boolean }) {
  const meta = CLASS_META[value];
  const Icon = meta.icon;
  const toneClass =
    value === "restricted" ? "bg-green text-white border-green" : value === "internal" ? "bg-brass-soft text-brass-text border-brass/50" : "bg-slate-soft text-slate border-slate/35";
  const sizeClass =
    size === "xs" ? "h-4.5 px-1 text-2xs gap-0.5 [&>svg]:size-2.5" : size === "sm" ? "h-5 px-1.5 text-2xs gap-1 [&>svg]:size-3" : "h-6 px-2 text-xs gap-1.5 [&>svg]:size-3.5";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-sm border font-medium leading-none tracking-[0.01em] whitespace-nowrap", toneClass, sizeClass, className)}
      title={`${meta.label}: ${meta.summary}`}
    >
      <Icon aria-hidden />
      {labelled ? meta.label : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

/* ---------------- Status dot ---------------- */

export type DotTone = "green" | "brass" | "deny" | "neutral" | "ink";

export function StatusDot({ tone, pulse, className, label }: { tone: DotTone; pulse?: boolean | undefined; className?: string; label?: string }) {
  const color = { green: "bg-green", brass: "bg-brass", deny: "bg-deny", neutral: "bg-ink-30", ink: "bg-ink" }[tone];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-label={label} role={label ? "img" : undefined}>
      {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}
