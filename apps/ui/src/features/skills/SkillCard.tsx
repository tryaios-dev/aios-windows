import { Plus } from 'lucide-react'
import { OWN_SKILL_ICON } from '@/assets/icons'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import type { SkillInstall } from '@/lib/extras'
import type { SkillEntry } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/chips'
import { DrawnTick, ProgressBar } from '@/components/app/InstallProgress'
import { SkillTile } from './SkillParts'

const CARD = 'relative flex h-full flex-col rounded-xl border bg-white p-5 shadow-card transition-[border-color,box-shadow,transform] duration-(--duration-panel) ease-(--ease-out)'
const CARD_LIVE = 'border-line focus-within:border-green/50 hover:-translate-y-px hover:border-green/40 hover:shadow-lift'
// The button covers the whole card, so anywhere on it opens the review. It must not move when pressed, or the cover would shrink under the pointer.
const COVER = 'static active:translate-y-0 after:absolute after:inset-0 after:rounded-xl'

/**
 * One skill you can add. What it does, how you would ask for it, who made it,
 * and one action. While it is being added the foot of the card shows the real
 * progress; when it is done the card says so and stays where it is until you
 * leave the page, so nothing vanishes from under the pointer.
 */
export function SkillCard({ skill, install, added, onReview }: { skill: SkillEntry; install?: SkillInstall; added: boolean; onReview: () => void }) {
  const state = install ? 'adding' : added ? 'added' : 'available'
  const pct = install ? Math.floor(install.progress * 100) : 0
  const checking = install?.stage === 'checking'

  return (
    <article className={cn(CARD, state === 'available' ? CARD_LIVE : state === 'added' ? 'border-green/45' : 'border-line')}>
      <div className="flex items-start gap-3.5">
        <SkillTile id={skill.id} category={skill.category} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-md font-semibold text-ink">{skill.name}</h3>
            <span className="label-mono shrink-0">{skill.category}</span>
          </div>
          <p className="mt-0.5 text-sm leading-5 text-ink-soft">{skill.line}</p>
        </div>
      </div>

      {/* How you would ask for it, set like a message you might send. */}
      <figure className="mt-4 rounded-[14px] rounded-tl-[4px] border border-line-soft bg-paper-raised px-3.5 py-2.5">
        <figcaption className="label-mono">Try asking</figcaption>
        <blockquote className="mt-1 text-sm leading-5 text-ink">“{skill.example}”</blockquote>
      </figure>

      <div className="mt-auto pt-4">
        <div className="flex min-h-[3.75rem] items-center border-t border-line-soft pt-3.5">
          {state === 'available' && (
            <div className="flex w-full items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm leading-5 text-ink-soft">{skill.publisher}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge tone={skill.open_source ? 'green' : 'neutral'}>{skill.open_source ? `Open source · ${skill.licence}` : skill.licence}</Badge>
                  <span className="font-mono text-xs tracking-[0.02em] tabular text-ink-50">{formatBytes(skill.size_bytes)}</span>
                </p>
              </div>
              <Button variant="outline" size="sm" leading={<Plus className="size-3.5" strokeWidth={2.25} />} className={cn(COVER, 'shrink-0')} onClick={onReview} aria-label={`Add ${skill.name}`}>
                Add
              </Button>
            </div>
          )}

          {state === 'adding' && (
            <div className="w-full animate-fade">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span role="status" className="text-sm font-medium leading-5 text-ink">
                  {checking ? 'Checking it' : 'Downloading'}
                </span>
                {!checking && (
                  <span className="font-mono text-xs tabular text-ink-soft" aria-hidden>
                    {pct}%
                  </span>
                )}
              </div>
              <ProgressBar size="sm" value={pct} active={!checking} indeterminate={checking} label={`Adding ${skill.name}`} valueText={checking ? 'Checking it' : `${pct} percent downloaded`} />
            </div>
          )}

          {state === 'added' && (
            <p role="status" className="flex w-full animate-fade items-center gap-2.5 text-sm leading-5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green text-white">
                <DrawnTick className="size-3" />
              </span>
              <span className="font-medium text-ink">Added</span>
              <span className="min-w-0 text-ink-soft">It is in your list above, turned on.</span>
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

/** The way in for a skill of your own: quieter than the listed skills, and last. */
export function OwnSkillCard({ wide, onOpen }: { /** Takes the full row when the listed skills fill theirs. */ wide: boolean; onOpen: () => void }) {
  return (
    <article
      className={cn(
        'relative flex h-full gap-x-6 gap-y-4 rounded-xl border border-dashed border-line-strong bg-paper-raised/70 p-5 transition-[border-color,background-color] duration-(--duration-panel) ease-(--ease-out) focus-within:border-green/60 hover:border-green/60 hover:bg-white',
        wide ? 'flex-col md:flex-row md:items-center' : 'flex-col',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(22,33,27,0.06)]">
          <img src={OWN_SKILL_ICON} alt="" draggable={false} className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-ink">Add your own skill</h3>
          <p className="mt-0.5 max-w-xl text-sm leading-5 text-ink-soft">
            If someone has given you a skill, or you have written one, you can add it here. It is a file ending <span className="font-mono text-xs tracking-[0.02em] text-ink">.aios-skill</span>. AIOS checks it and shows you what it wants to use before it can run.
          </p>
        </div>
      </div>
      <div className={cn('shrink-0', !wide && 'mt-auto')}>
        <Button size="sm" className={COVER} onClick={onOpen}>
          Add from a file
        </Button>
      </div>
    </article>
  )
}
