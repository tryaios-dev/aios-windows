import * as React from "react";
import { Building2, Globe, Lock, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Classification, ProviderType } from "@/lib/types";

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

export function Badge({
  tone = "neutral",
  className,
  children,
  mono,
  icon,
}: {
  tone?: BadgeTone | undefined;
  className?: string | undefined;
  children: React.ReactNode;
  mono?: boolean | undefined;
  icon?: React.ReactNode | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium leading-none whitespace-nowrap",
        mono && "font-mono tracking-wide",
        tones[tone],
        className,
      )}
    >
      {icon && <span className="[&>svg]:size-3">{icon}</span>}
      {children}
    </span>
  );
}

/* ---------------- Classification chip ---------------- */

export const CLASS_META: Record<
  Classification,
  {
    label: string;
    short: string;
    icon: React.ComponentType<{ className?: string | undefined }>;
    summary: string;
    detail: string;
  }
> = {
  restricted: {
    label: "Restricted",
    short: "Restricted",
    icon: Lock,
    summary: "Stays on this device. The safest setting and the default.",
    detail:
      "Everything in a Restricted project stays on this device unless you move a conversation to Company AI yourself. New projects start here.",
  },
  internal: {
    label: "Internal",
    short: "Internal",
    icon: Building2,
    summary: "Meant for people inside your organisation.",
    detail:
      "Recorded on every conversation, message and summary in this project. Classes are recorded and shown; not enforced in this version.",
  },
  public: {
    label: "Public",
    short: "Public",
    icon: Globe,
    summary: "Nothing confidential.",
    detail: "Recorded on every item in this project. Classes are recorded and shown; not enforced in this version.",
  },
};

export function ClassChip({
  value,
  size = "sm",
  className,
  labelled = true,
}: {
  value: Classification;
  size?: "xs" | "sm" | "md";
  className?: string | undefined;
  labelled?: boolean | undefined;
}) {
  const meta = CLASS_META[value];
  const Icon = meta.icon;
  const toneClass =
    value === "restricted"
      ? "bg-green text-white border-green"
      : value === "internal"
        ? "bg-brass-soft text-brass-text border-brass/50"
        : "bg-slate-soft text-slate border-slate/35";
  const sizeClass =
    size === "xs"
      ? "h-4.5 px-1 text-2xs gap-0.5 [&>svg]:size-2.5"
      : size === "sm"
        ? "h-5 px-1.5 text-2xs gap-1 [&>svg]:size-3"
        : "h-6 px-2 text-xs gap-1.5 [&>svg]:size-3.5";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm border font-medium leading-none tracking-[0.01em] whitespace-nowrap",
        toneClass,
        sizeClass,
        className,
      )}
      title={`${meta.label}: ${meta.summary}`}
    >
      <Icon aria-hidden />
      {labelled ? meta.label : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

/* ---------------- Provider badge ---------------- */

export function ProviderBadge({
  provider,
  model,
  size = "sm",
  className,
  muted,
}: {
  provider: ProviderType;
  model?: string | undefined;
  size?: "sm" | "md";
  className?: string | undefined;
  muted?: boolean | undefined;
}) {
  const isLocal = provider === "local";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border font-medium leading-none whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        isLocal ? "border-green/25 bg-green-wash text-green-dark" : "border-ink/20 bg-paper-deep text-ink",
        muted && "opacity-80",
        className,
      )}
      title={isLocal ? "Answered by the local model on this device" : "Answered by the company AI server"}
    >
      {isLocal ? <MonitorSmartphone className="size-3" aria-hidden /> : <Building2 className="size-3" aria-hidden />}
      <span>{isLocal ? "Local" : "Company"}</span>
      {model && (
        <>
          <span className="opacity-40">·</span>
          <span className="font-normal">{model}</span>
        </>
      )}
    </span>
  );
}

/* ---------------- Status dot ---------------- */

export type DotTone = "green" | "brass" | "deny" | "neutral" | "ink";

export function StatusDot({
  tone,
  pulse,
  className,
  label,
}: {
  tone: DotTone;
  pulse?: boolean | undefined;
  className?: string | undefined;
  label?: string | undefined;
}) {
  const color = { green: "bg-green", brass: "bg-brass", deny: "bg-deny", neutral: "bg-ink-30", ink: "bg-ink" }[tone];
  return (
    <span
      className={cn("relative inline-flex size-2 shrink-0", className)}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}
