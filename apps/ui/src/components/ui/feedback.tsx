import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/cn";

/* ---------------- Callout ---------------- */

export type CalloutTone = "info" | "caution" | "deny" | "success" | "neutral";

const calloutTones: Record<CalloutTone, { box: string; icon: React.ReactNode }> = {
  info: { box: "border-green/25 bg-green-wash text-ink", icon: <Info className="text-green" /> },
  success: { box: "border-green/25 bg-green-wash text-ink", icon: <CheckCircle2 className="text-green" /> },
  caution: { box: "border-brass/40 bg-brass-soft text-ink", icon: <AlertTriangle className="text-brass-text" /> },
  deny: { box: "border-deny/30 bg-deny-soft text-ink", icon: <OctagonAlert className="text-deny" /> },
  neutral: { box: "border-line bg-paper text-ink", icon: <Info className="text-ink-50" /> },
};

export function Callout({ tone = "info", title, children, className, action, compact }: { tone?: CalloutTone; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode; compact?: boolean }) {
  const t = calloutTones[tone];
  return (
    <div role={tone === "deny" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border", compact ? "px-3 py-2.5" : "px-3.5 py-3", t.box, className)}>
      <span className="mt-0.5 shrink-0 [&>svg]:size-4">{t.icon}</span>
      <div className="min-w-0 flex-1 text-sm leading-5">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children && <div className={cn("text-ink-soft", title && "mt-0.5")}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/* ---------------- Spinner ---------------- */

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-ink-50", className)} aria-label={label} role="status" />;
}

/* ---------------- Empty state ---------------- */

export function EmptyState({ icon, title, description, action, className, display, compact }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; display?: boolean; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-16", className)}>
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-paper-raised text-ink-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] [&>svg]:size-5">
          {icon}
        </div>
      )}
      <h3 className={cn("text-ink", display ? "font-display text-2xl" : "text-base font-semibold")}>{title}</h3>
      {description && <p className={cn("mt-1.5 text-sm leading-5 text-ink-soft", display ? "max-w-md" : "max-w-sm")}>{description}</p>}
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  );
}
