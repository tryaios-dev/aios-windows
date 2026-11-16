import * as React from 'react'
import { AlertDialog as RAlert, Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, IconButton, type ButtonVariant } from './button'

/* ---------------- Tooltip ---------------- */

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RTooltip.Provider>
  )
}

export function Tooltip({ content, children, side = 'top', align = 'center' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' }) {
  if (!content) return <>{children}</>
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} align={align} sideOffset={6} className="z-[60] max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs leading-4.5 text-paper shadow-lift animate-in">
          {content}
          <RTooltip.Arrow className="fill-ink" width={8} height={4} />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

/* ---------------- Dialog ---------------- */

const overlayClass = 'fixed inset-0 z-50 bg-ink/30 backdrop-blur-[3px] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out'
// Tall content scrolls inside the dialog, so a dialog is never cut off by a short window.
const contentBase = 'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-40px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_0_rgba(22,33,27,0.04),0_32px_64px_-28px_rgba(22,33,27,0.45)] focus:outline-none data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out'

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  width?: keyof typeof widths
  hideClose?: boolean
  /** Hide the standard padding when the body needs edge-to-edge content. */
  bare?: boolean
  eyebrow?: React.ReactNode
}

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 'md', hideClose, bare, eyebrow }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={overlayClass} />
        <RDialog.Content className={cn(contentBase, widths[width])}>
          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5">
            <div className="min-w-0">
              {eyebrow && <div className="label-mono mb-1.5">{eyebrow}</div>}
              <RDialog.Title className="text-lg font-semibold leading-6 text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-sm text-ink-soft">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>}
            </div>
            {!hideClose && (
              <RDialog.Close asChild>
                <IconButton label="Close" size="sm" className="-mr-2 -mt-1" >
                  <X />
                </IconButton>
              </RDialog.Close>
            )}
          </div>
          {children && <div className={cn('min-h-0 flex-1 overflow-y-auto', bare ? 'mt-4' : 'px-6 pt-4 pb-1')}>{children}</div>}
          {footer && <div className="mt-5 flex shrink-0 items-center justify-end gap-2 border-t border-line-soft bg-paper-raised/70 px-6 py-3.5">{footer}</div>}
          {!footer && <div className="shrink-0 pb-5" />}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/* ---------------- AlertDialog (confirmations, disclosure boundary) ---------------- */

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: ButtonVariant
  onConfirm: () => void
  loading?: boolean
  eyebrow?: React.ReactNode
  disabled?: boolean
  width?: keyof typeof widths
}

export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', confirmVariant = 'primary', onConfirm, loading, eyebrow, disabled, width = 'sm' }: ConfirmDialogProps) {
  return (
    <RAlert.Root open={open} onOpenChange={onOpenChange}>
      <RAlert.Portal>
        <RAlert.Overlay className={overlayClass} />
        <RAlert.Content className={cn(contentBase, widths[width])}>
          <div className="px-6 pt-5">
            {eyebrow && <div className="label-mono mb-1.5">{eyebrow}</div>}
            <RAlert.Title className="text-lg font-semibold leading-6 text-ink">{title}</RAlert.Title>
            {description ? <RAlert.Description className="mt-1.5 text-sm leading-5 text-ink-soft">{description}</RAlert.Description> : <RAlert.Description className="sr-only">Confirmation</RAlert.Description>}
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4">{children}</div>}
          <div className="mt-5 flex shrink-0 items-center justify-end gap-2 border-t border-line-soft bg-paper-raised/70 px-6 py-3.5">
            <RAlert.Cancel asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </RAlert.Cancel>
            <RAlert.Action asChild>
              <Button
                variant={confirmVariant}
                loading={loading}
                disabled={disabled}
                onClick={(e) => {
                  e.preventDefault()
                  onConfirm()
                }}
              >
                {confirmLabel}
              </Button>
            </RAlert.Action>
          </div>
        </RAlert.Content>
      </RAlert.Portal>
    </RAlert.Root>
  )
}

/* ---------------- Sheet (side drawer) ---------------- */

export function Sheet({ open, onOpenChange, title, description, children, width = 'w-[420px]', side = 'right', eyebrow, footer, bare }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; width?: string; side?: 'right' | 'left'; eyebrow?: React.ReactNode; footer?: React.ReactNode; /** No header or padding: the child owns the whole panel. */ bare?: boolean }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={overlayClass} />
        <RDialog.Content
          className={cn(
            'fixed inset-y-0 z-50 flex max-w-[calc(100vw-24px)] flex-col bg-white shadow-plate focus:outline-none',
            side === 'right' ? 'right-0 border-l border-line data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right' : 'left-0 border-r border-line data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left',
            width,
          )}
        >
          {bare ? (
            <>
              <RDialog.Title className="sr-only">{title}</RDialog.Title>
              <RDialog.Description className="sr-only">{description ?? 'Panel'}</RDialog.Description>
              <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            </>
          ) : (
            <>
          <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 pb-4 pt-4">
            <div className="min-w-0">
              {eyebrow && <div className="label-mono mb-1">{eyebrow}</div>}
              <RDialog.Title className="truncate text-base font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-0.5 text-sm text-ink-soft">{description}</RDialog.Description> : <RDialog.Description className="sr-only">Panel</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Close" size="sm" className="-mr-1.5">
                <X />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</div>}
            </>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/* ---------------- Dropdown menu ---------------- */

export const Menu = RMenu.Root
export const MenuTrigger = RMenu.Trigger

export function MenuContent({ className, children, align = 'end', sideOffset = 4, ...props }: React.ComponentProps<typeof RMenu.Content>) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-white p-1 shadow-pop data-[state=open]:animate-in data-[state=closed]:animate-out', className)}
        {...props}
      >
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  )
}

export function MenuItem({ className, destructive, icon, shortcut, children, ...props }: React.ComponentProps<typeof RMenu.Item> & { destructive?: boolean; icon?: React.ReactNode; shortcut?: string }) {
  return (
    <RMenu.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors duration-(--duration-micro) data-[highlighted]:bg-paper-deep data-[disabled]:pointer-events-none data-[disabled]:text-ink-50',
        destructive ? 'text-deny data-[highlighted]:bg-deny-soft' : 'text-ink',
        className,
      )}
      {...props}
    >
      {icon && <span className="flex size-4 items-center justify-center text-ink-50 [&>svg]:size-3.5 [.text-deny_&]:text-deny">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="font-mono text-2xs text-ink-50">{shortcut}</span>}
    </RMenu.Item>
  )
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px bg-line-soft" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <RMenu.Label className="label-mono px-2 pb-1 pt-1.5">{children}</RMenu.Label>
}

export const MenuRadioGroup = RMenu.RadioGroup
export function MenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof RMenu.RadioItem>) {
  return (
    <RMenu.RadioItem className={cn('relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-7 pr-2 text-sm text-ink outline-none data-[highlighted]:bg-paper-deep', className)} {...props}>
      <RMenu.ItemIndicator className="absolute left-2 size-3.5 text-green">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>
      </RMenu.ItemIndicator>
      {children}
    </RMenu.RadioItem>
  )
}

/* ---------------- Popover ---------------- */

export const Popover = RPopover.Root
export const PopoverTrigger = RPopover.Trigger
export function PopoverContent({ className, children, align = 'end', sideOffset = 6, ...props }: React.ComponentProps<typeof RPopover.Content>) {
  return (
    <RPopover.Portal>
      <RPopover.Content align={align} sideOffset={sideOffset} className={cn('z-50 w-72 rounded-lg border border-line bg-white p-3 shadow-pop data-[state=open]:animate-in data-[state=closed]:animate-out', className)} {...props}>
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  )
}
