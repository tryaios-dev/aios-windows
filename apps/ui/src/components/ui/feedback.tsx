import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ToastKind } from '@/lib/types'
import { IconButton } from './button'

/* ---------------- Callout ---------------- */

export type CalloutTone = 'info' | 'caution' | 'deny' | 'success' | 'neutral'

const calloutTones: Record<CalloutTone, { box: string; icon: React.ReactNode }> = {
  info: { box: 'border-green/25 bg-green-wash text-ink', icon: <Info className="text-green" /> },
  success: { box: 'border-green/25 bg-green-wash text-ink', icon: <CheckCircle2 className="text-green" /> },
  caution: { box: 'border-brass/40 bg-brass-soft text-ink', icon: <AlertTriangle className="text-brass-text" /> },
  deny: { box: 'border-deny/30 bg-deny-soft text-ink', icon: <OctagonAlert className="text-deny" /> },
  neutral: { box: 'border-line bg-paper text-ink', icon: <Info className="text-ink-50" /> },
}

export function Callout({ tone = 'info', title, children, className, action, compact }: { tone?: CalloutTone; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode; compact?: boolean }) {
  const t = calloutTones[tone]
  return (
    <div role={tone === 'deny' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border', compact ? 'px-3 py-2.5' : 'px-3.5 py-3', t.box, className)}>
      <span className="mt-0.5 shrink-0 [&>svg]:size-4">{t.icon}</span>
      <div className="min-w-0 flex-1 text-sm leading-5">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children && <div className={cn('text-ink-soft', title && 'mt-0.5')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

/* ---------------- Progress ---------------- */

export function Progress({ value, className, tone = 'green', indeterminate, label }: { value: number; className?: string; tone?: 'green' | 'brass' | 'deny'; indeterminate?: boolean; label?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  const bar = { green: 'bg-green', brass: 'bg-brass', deny: 'bg-deny' }[tone]
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-ink-12', className)} role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      {indeterminate ? (
        <div className={cn('absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full', bar)} />
      ) : (
        <div className={cn('h-full rounded-full transition-[width] duration-300 ease-(--ease-out)', bar)} style={{ width: `${pct}%` }} />
      )}
    </div>
  )
}

/* ---------------- Spinner ---------------- */

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-ink-50', className)} aria-label={label} role="status" />
}

/* ---------------- Empty state ---------------- */

export function EmptyState({ icon, title, description, action, className, display, compact }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; display?: boolean; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-16', className)}>
      {icon && <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-paper-raised text-ink-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] [&>svg]:size-5">{icon}</div>}
      <h3 className={cn('text-ink', display ? 'font-display text-2xl' : 'text-base font-semibold')}>{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-5 text-ink-soft">{description}</p>}
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  )
}

/* ---------------- Toasts ---------------- */

const toastIcons: Record<ToastKind, React.ReactNode> = {
  info: <Info className="text-green" />,
  success: <CheckCircle2 className="text-green" />,
  caution: <AlertTriangle className="text-brass-text" />,
  deny: <OctagonAlert className="text-deny" />,
}

export function ToastCard({ kind, title, description, action, onDismiss }: { kind: ToastKind; title: string; description?: string; action?: { label: string; onClick?: () => void; href?: string }; onDismiss: () => void }) {
  return (
    <div role={kind === 'deny' ? 'alert' : 'status'} className="pointer-events-auto flex w-[360px] max-w-[calc(100vw-32px)] animate-toast-in gap-3 rounded-lg border border-line bg-white px-3.5 py-3 shadow-lift">
      <span className="mt-0.5 shrink-0 [&>svg]:size-4">{toastIcons[kind]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-ink">{title}</div>
        {description && <div className="mt-0.5 text-sm leading-5 text-ink-soft">{description}</div>}
        {action && (
          <div className="mt-2">
            {action.href ? (
              <a href={action.href} className="text-sm font-medium text-green hover:underline" onClick={(e) => { e.preventDefault(); action.onClick?.(); window.dispatchEvent(new CustomEvent('aios:navigate', { detail: action.href })) }}>
                {action.label}
              </a>
            ) : (
              <button className="text-sm font-medium text-green hover:underline" onClick={action.onClick}>
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
      <IconButton label="Dismiss" size="sm" className="-mr-1.5 -mt-1" onClick={onDismiss}>
        <X />
      </IconButton>
    </div>
  )
}
