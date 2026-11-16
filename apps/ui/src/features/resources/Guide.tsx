import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { RadioGroup as RRadio } from 'radix-ui'
import { ArrowRight, Check, Lock } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ResourceEntry } from '@/lib/types'
import { GUIDE_TASKS, resourceById, type GuideTask } from '@/data/resources'
import { Button } from '@/components/ui/button'
import { DrawnCheck } from '@/features/settings/shared'
import { SmoothHeight } from '@/features/skills/shared'
import { TASK_ICON } from '@/assets/icons'
import { KindTile, LinkedMark, PriceLines } from './ResourceParts'

/**
 * The guide starts from the job, not the product. The person says what they
 * want to do; AIOS says honestly whether this computer can already do it, and
 * only if it cannot, which resource fits best and what it costs.
 */
export function Guide({ linkedIds, linkedHere, onLink }: { linkedIds: ReadonlySet<string>; linkedHere: ReadonlySet<string>; onLink: (resource: ResourceEntry) => void }) {
  const [taskId, setTaskId] = useState('')
  const task = GUIDE_TASKS.find((t) => t.id === taskId)
  const answer = useRef<HTMLDivElement>(null)

  // Once the answer has opened, bring the whole of it into view if part is below the window. Never on arrival: only after a choice.
  useEffect(() => {
    if (!taskId) return
    const timer = window.setTimeout(() => {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      answer.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
    }, 320)
    return () => window.clearTimeout(timer)
  }, [taskId])

  return (
    <section aria-labelledby="guide-title" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="p-6">
        <div className="label-mono">Start here</div>
        <h2 id="guide-title" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
          What do you want to do?
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-soft">Choose the closest. AIOS tells you whether this computer can do it, and what to add if it cannot.</p>

        <RRadio.Root value={taskId} onValueChange={setTaskId} aria-labelledby="guide-title" className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDE_TASKS.map((t) => (
            <RRadio.Item
              key={t.id}
              value={t.id}
              className="group flex min-h-16 items-center gap-3 rounded-lg border border-line bg-paper-raised p-3 text-left transition-[border-color,background-color,box-shadow] duration-(--duration-micro) ease-(--ease-out) hover:border-line-strong hover:bg-white data-[state=checked]:border-green data-[state=checked]:bg-white data-[state=checked]:shadow-[0_0_0_1px_var(--color-green)]"
            >
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(22,33,27,0.06)] transition-[border-color,box-shadow] duration-(--duration-panel) ease-(--ease-out) group-data-[state=checked]:border-green/50"
              >
                <img src={TASK_ICON[t.id] ?? TASK_ICON.write} alt="" draggable={false} className="size-7" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium leading-5 text-ink">{t.label}</span>
              <Check className="size-4 shrink-0 text-green opacity-0 transition-opacity duration-(--duration-micro) group-data-[state=checked]:opacity-100" strokeWidth={2.25} aria-hidden />
            </RRadio.Item>
          ))}
        </RRadio.Root>
      </div>

      <div ref={answer} aria-live="polite" className="scroll-mb-6">
        <SmoothHeight>
          {task && (
            <div key={task.id} className="animate-fade border-t border-line-soft bg-paper-raised px-6 py-5">
              <Recommendation task={task} linkedIds={linkedIds} linkedHere={linkedHere} onLink={onLink} />
            </div>
          )}
        </SmoothHeight>
      </div>
    </section>
  )
}

/* ---------------- The answer ---------------- */

function Recommendation({ task, linkedIds, linkedHere, onLink }: { task: GuideTask; linkedIds: ReadonlySet<string>; linkedHere: ReadonlySet<string>; onLink: (resource: ResourceEntry) => void }) {
  const navigate = useNavigate()
  const suggestions = task.suggest.map((id) => resourceById(id)).filter((r): r is ResourceEntry => !!r)

  // The honest answer: nothing extra is needed.
  if (task.local || suggestions.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex min-w-[min(100%,20rem)] flex-1 items-start gap-4">
          <span aria-hidden className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-green text-white">
            <DrawnCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 text-ink-soft">For {task.job}</p>
            <h3 className="mt-0.5 text-lg font-semibold leading-6 text-ink">This computer can do this.</h3>
            <p className="mt-1 max-w-xl text-sm leading-5 text-ink-soft">{task.why}</p>
          </div>
        </div>
        <Button variant="primary" size="lg" trailing={<ArrowRight className="size-4" />} onClick={() => navigate('/')}>
          Start a conversation
        </Button>
      </div>
    )
  }

  const [best] = suggestions
  return (
    <div>
      <p className="text-sm leading-5 text-ink-soft">For {task.job}</p>
      <h3 className="mt-0.5 text-lg font-semibold leading-6 text-ink">The best fit is {best.name}.</h3>
      <p className="mt-1 max-w-2xl text-sm leading-5 text-ink-soft">{task.why}</p>

      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {suggestions.map((resource, i) => (
          <li key={resource.id}>
            <Suggestion resource={resource} best={i === 0} linked={linkedIds.has(resource.id)} drawn={linkedHere.has(resource.id)} onLink={() => onLink(resource)} />
          </li>
        ))}
      </ul>

      <p className="mt-3.5 flex items-start gap-2 text-xs leading-4.5 text-ink-50">
        <Lock className="mt-[3px] size-3 shrink-0 text-green" strokeWidth={2.25} aria-hidden />
        Linking sends nothing. AIOS asks every time before anything leaves this computer.
      </p>
    </div>
  )
}

function Suggestion({ resource, best, linked, drawn, onLink }: { resource: ResourceEntry; best: boolean; linked: boolean; drawn: boolean; onLink: () => void }) {
  return (
    <article className={cn('flex h-full flex-col rounded-lg border bg-white p-4 ring-1', best ? 'border-green/45 ring-green/15' : 'border-line ring-transparent')}>
      <div className={cn('label-mono', best && 'text-green!')}>{best ? 'Best fit' : 'Also works'}</div>
      <div className="mt-2.5 flex items-start gap-3">
        <KindTile resource={resource} size="sm" />
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold leading-5 text-ink">{resource.name}</h4>
          <p className="mt-0.5 text-xs leading-4.5 text-ink-50">
            {resource.provider} · {resource.region}
          </p>
        </div>
      </div>
      <p className="mt-2.5 text-sm leading-5 text-ink-soft">{resource.line}</p>
      <PriceLines resource={resource} className="mt-3 border-t border-line-soft pt-3" />
      <div className="mt-auto flex items-center pt-4">
        {linked ? (
          <LinkedMark drawn={drawn} />
        ) : (
          <Button variant={best ? 'primary' : 'secondary'} size="sm" onClick={onLink} aria-label={`Link ${resource.name}`}>
            Link
          </Button>
        )}
      </div>
    </article>
  )
}
