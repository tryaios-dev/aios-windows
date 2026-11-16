import type { ReactNode } from 'react'
import { Ban, FileAudio, FileText, Laptop, MessageSquareText, Mic, Sheet } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SKILL_CATEGORY_ICON, SKILL_ICON } from '@/assets/icons'
import { formatBytes } from '@/lib/format'
import type { SkillEntry } from '@/lib/types'

/* ---------------- Category tile ---------------- */

/**
 * The icon for a skill: a full-colour picture on a white soft square, so each
 * skill can be recognised before its name is read. The picture comes from the
 * skill itself where it has one, and from its kind otherwise.
 */
export function SkillTile({ id, category, size = 'md', dimmed, className }: { /** The skill's id, when it has an icon of its own. */ id?: string; category: SkillEntry['category']; size?: 'md' | 'lg'; /** The skill is switched off. */ dimmed?: boolean; className?: string }) {
  const src = (id && SKILL_ICON[id]) || SKILL_CATEGORY_ICON[category]
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center border border-line bg-white shadow-[0_1px_2px_rgba(22,33,27,0.06)] transition-[opacity,filter] duration-(--duration-panel) ease-(--ease-out)',
        size === 'lg' ? 'size-[52px] rounded-[14px]' : 'size-11 rounded-xl',
        dimmed && 'opacity-45 grayscale',
        className,
      )}
    >
      <img src={src} alt="" draggable={false} className={size === 'lg' ? 'size-8' : 'size-7'} />
    </span>
  )
}

/* ---------------- What it can use ---------------- */

function iconForUse(use: string): ReactNode {
  const text = use.toLowerCase()
  if (text.includes('microphone')) return <Mic />
  if (text.includes('recording')) return <FileAudio />
  if (text.includes('spreadsheet')) return <Sheet />
  if (text.includes('document')) return <FileText />
  return <MessageSquareText />
}

/**
 * The review a person sees before a skill can run: each thing it may use, one
 * per line, and a closing line that says the list is complete.
 */
export function UsesList({ uses, className }: { uses: string[]; className?: string }) {
  return (
    <section className={className}>
      <h3 className="label-mono">What it can use</h3>
      <ul className="mt-2 overflow-hidden rounded-lg border border-line bg-white">
        {uses.map((use) => (
          <li key={use} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md border border-green/15 bg-green-wash text-green [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">
              {iconForUse(use)}
            </span>
            <span className="min-w-0 flex-1 text-sm leading-5 text-ink">{use}</span>
          </li>
        ))}
        <li className="flex items-center gap-3 bg-paper-raised px-3.5 py-2.5">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line-soft bg-white text-ink-50 [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">
            <Ban />
          </span>
          <span className="min-w-0 flex-1 text-sm leading-5 text-ink-soft">Nothing else. A skill cannot use what is not on this list.</span>
        </li>
      </ul>
    </section>
  )
}

/** Where a skill runs, said once and plainly. */
export function RunsHere({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-2.5 rounded-lg border border-green/20 bg-green-wash px-3.5 py-2.5 text-sm font-medium leading-5 text-ink', className)}>
      <Laptop className="size-4 shrink-0 text-green" strokeWidth={1.75} aria-hidden />
      Runs on this computer. Nothing is sent anywhere.
    </p>
  )
}

/* ---------------- Who made it ---------------- */

export function SkillFacts({ skill, className }: { skill: SkillEntry; className?: string }) {
  const facts: Array<{ k: string; v: ReactNode; mono?: boolean }> = [
    { k: 'Publisher', v: skill.publisher },
    {
      k: 'Licence',
      v: (
        <>
          {skill.licence}
          {skill.open_source && <span className="block text-xs leading-4.5 text-green-dark">Open source</span>}
        </>
      ),
    },
    { k: 'Version', v: skill.version, mono: true },
    { k: 'Size', v: formatBytes(skill.size_bytes), mono: true },
  ]
  return (
    <dl className={cn('grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4', className)}>
      {facts.map((f) => (
        <div key={f.k} className="min-w-0">
          <dt className="label-mono">{f.k}</dt>
          <dd className={cn('mt-1 leading-5 text-ink', f.mono ? 'font-mono text-xs tracking-[0.02em] tabular' : 'text-sm')}>{f.v}</dd>
        </div>
      ))}
    </dl>
  )
}
