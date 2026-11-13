import { describeEvent, exampleLines, type ActivityLine } from '@/lib/activity'
import { Button } from '@/components/ui/button'
import { Art } from '@/components/ui/art'
import { KIND_ART, sentenceParts } from './activityMeta'

/**
 * Made once: the sentences `describeEvent` would write, from stand-in events that are never recorded.
 * Adding documents is one of the first things people do, so the guide shows that line too, straight after the question.
 */
const LINES: ActivityLine[] = (() => {
  const base = exampleLines()
  if (base.some((line) => line.kind === 'knowledge')) return base
  const added = describeEvent(
    { seq: -5, format_version: 1, stream_id: 'example', epoch: 0, ts: '', event_type: 'knowledge_added', actor: 'user', prev_hash: '', event_hash: '', payload: { documents: 3, could_not_read: 0 } },
    { projects: [], conversations: [], installed: [] },
  )
  return [...base.slice(0, 1), { ...added, about: undefined }, ...base.slice(1)]
})()

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
const lineCount = `${COUNT_WORDS[LINES.length] ?? String(LINES.length)} ${LINES.length === 1 ? 'line is an example' : 'lines are examples'}`

const HIDDEN_KEY = 'aios.activity.examples.hidden'

/** Whether the guide was hidden earlier in this session. Storage can be unavailable; then it shows again. */
export function examplesHiddenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function hideExamplesThisSession(): void {
  try {
    window.sessionStorage.setItem(HIDDEN_KEY, '1')
  } catch {
    // Hidden for this visit to the page only.
  }
}

/**
 * A guide for a new installation: what Activity will hold once AIOS is in use.
 * It sits above the real list, never inside it. Every row is marked "Example", has a dashed
 * outline and cannot be opened, so it cannot be mistaken for something that happened.
 * The parent shows it only while no question has been asked on this computer.
 */
export function ActivityExamples({ onHide }: { onHide: () => void }) {
  return (
    <section aria-labelledby="activity-examples-title" className="rounded-lg border border-dashed border-line-strong bg-paper-raised">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 id="activity-examples-title" className="text-base font-semibold text-ink">
            What you will see here
          </h2>
          <p className="mt-0.5 max-w-2xl text-sm leading-5 text-ink-soft">These {lineCount}. Your real entries appear in the list below as things happen.</p>
        </div>
        <Button variant="ghost" size="sm" className="-mr-1.5 shrink-0" onClick={onHide}>
          Hide examples
        </Button>
      </div>
      <ul className="border-t border-dashed border-line">
        {LINES.map((line, i) => {
          const { who, rest } = sentenceParts(line)
          return (
            <li key={i} className="flex items-center gap-3 border-b border-dashed border-line px-4 py-2.5 last:border-b-0">
              <span className="inline-flex h-5 w-16 shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-2xs font-medium text-ink-50">Example</span>
              <Art src={KIND_ART[line.kind]} className="size-[18px] opacity-80" />
              <span className="min-w-0 flex-1 text-base leading-5 text-ink-soft">
                <span className="font-medium">{who}</span> {rest}
              </span>
              <span className="hidden shrink-0 text-xs whitespace-nowrap text-ink-50 sm:block">{line.where}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
