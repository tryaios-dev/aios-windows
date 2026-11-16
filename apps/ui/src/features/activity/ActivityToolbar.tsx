import type { ReactNode } from 'react'
import { RadioGroup } from 'radix-ui'
import { ArrowUpRight, X } from 'lucide-react'
import { ACTIVITY_KINDS, type ActivityKind } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { Art } from '@/components/ui/art'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/fields'
import { ALL_PROJECTS, KIND_ART, type ActivityViewMode } from './activityMeta'

interface ToolbarProps {
  kinds: Set<ActivityKind>
  kindCounts: Record<ActivityKind, number>
  onToggleKind: (kind: ActivityKind) => void
  leftOnly: boolean
  leftCount: number
  onToggleLeft: () => void
  /** Present on the whole-computer route only. */
  projectOptions?: Array<{ value: string; label: string }>
  projectFilter: string
  onProjectFilter: (value: string) => void
  anyFilter: boolean
  onClear: () => void
  /** Show every kind again, keeping the chosen project. */
  onAllKinds: () => void
  view: ActivityViewMode
  onView: (view: ActivityViewMode) => void
}

/**
 * Two rows. First, which project and how much detail (Plain or Verification details).
 * Then what kind of thing happened, as chips with the same colour icons the list uses.
 */
export function ActivityToolbar({ kinds, kindCounts, onToggleKind, leftOnly, leftCount, onToggleLeft, projectOptions, projectFilter, onProjectFilter, anyFilter, onClear, onAllKinds, view, onView }: ToolbarProps) {
  const total = ACTIVITY_KINDS.reduce((n, k) => n + kindCounts[k.key], 0)
  const narrowed = kinds.size > 0 || leftOnly
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-lg font-semibold leading-7 text-ink">What happened</h2>
          {projectOptions && (
            <Select
              size="sm"
              aria-label="Project"
              value={projectFilter}
              onValueChange={onProjectFilter}
              options={[{ value: ALL_PROJECTS, label: 'All projects' }, ...projectOptions]}
              className="w-44"
            />
          )}
        </div>
        <RadioGroup.Root
          value={view}
          onValueChange={(v) => onView(v as ActivityViewMode)}
          orientation="horizontal"
          aria-label="How much detail to show"
          className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-paper-deep p-0.5"
        >
          <Segment value="plain">Plain</Segment>
          <Segment value="verify">Verification details</Segment>
        </RadioGroup.Root>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter activity">
        <FilterChip count={total} active={!narrowed} onToggle={onAllKinds}>
          Everything
        </FilterChip>
        {ACTIVITY_KINDS.map((k) => (
          <FilterChip key={k.key} art={KIND_ART[k.key]} count={kindCounts[k.key]} active={kinds.has(k.key)} disabled={kindCounts[k.key] === 0 && !kinds.has(k.key)} onToggle={() => onToggleKind(k.key)}>
            {k.label}
          </FilterChip>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        <FilterChip count={leftCount} active={leftOnly} tone="brass" onToggle={onToggleLeft} icon={<ArrowUpRight className="size-3.5" aria-hidden />}>
          Left this computer
        </FilterChip>
        {anyFilter && (
          <Button variant="ghost" size="sm" leading={<X className="size-3" aria-hidden />} onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}

function Segment({ value, children }: { value: ActivityViewMode; children: ReactNode }) {
  return (
    <RadioGroup.Item
      value={value}
      className="inline-flex h-6.5 select-none items-center rounded-sm px-3 text-sm font-medium text-ink-soft transition-[background-color,color,box-shadow] duration-(--duration-micro) ease-(--ease-out) hover:text-ink data-[state=checked]:bg-white data-[state=checked]:text-ink data-[state=checked]:shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgba(22,33,27,0.06)]"
    >
      {children}
    </RadioGroup.Item>
  )
}

function FilterChip({ children, count, active, disabled, tone = 'green', icon, art, onToggle }: { children: ReactNode; count: number; active: boolean; disabled?: boolean; tone?: 'green' | 'brass'; icon?: ReactNode; /** A colour icon from `KIND_ART`. */ art?: string; onToggle: () => void }) {
  const on = tone === 'brass' ? 'border-brass/60 bg-brass-tint text-brass-text' : 'border-green/45 bg-green-wash text-green-dark shadow-[0_0_0_1px_rgba(30,95,70,0.12)]'
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'inline-flex h-8 select-none items-center gap-1.5 rounded-full border pr-2.5 text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-(--duration-micro) ease-(--ease-out) disabled:cursor-not-allowed disabled:opacity-45',
        art ? 'pl-1.5' : 'pl-3',
        active ? on : 'border-line bg-white text-ink-soft hover:border-line-strong hover:text-ink',
      )}
    >
      {art && <Art src={art} className={cn('size-[18px]', disabled && 'grayscale')} />}
      {icon && <span className={cn('shrink-0', !active && tone === 'brass' && 'text-brass-text')}>{icon}</span>}
      {children}
      <span className={cn('text-xs font-normal tabular', active ? 'opacity-70' : 'text-ink-50')}>{count}</span>
    </button>
  )
}
