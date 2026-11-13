import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { LibraryBig } from 'lucide-react'
import { ART, STARTER_ART } from '@/assets/icons'
import { Art } from '@/components/ui/art'
import { STARTERS, type Starter } from '@/data/stack'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/overlays'

/** The colour icon for a ready-made request. */
export function starterIcon(id: string): ReactNode {
  return <Art src={STARTER_ART[id] ?? ART.conversation} />
}

/**
 * The starters for a conversation with nothing in it yet. Each has two ways in:
 * "Write my own" puts the request in the message box with blanks to fill, and
 * "Try it with an example" puts the whole request there with sample text, so Enter is all that is left.
 * Neither sends anything; the person always presses Enter themselves.
 */
export function StarterList({ onPick, knowledgeHint }: { onPick: (starter: Starter, withExample: boolean) => void; /** Say that the AI can use documents too. For conversations on this computer. */ knowledgeHint?: boolean }) {
  return (
    <div className="w-full max-w-[640px]">
      <ul className="overflow-hidden rounded-xl border border-line bg-paper-raised text-left">
        {STARTERS.map((starter) => (
          <li key={starter.id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-line-soft px-4 py-3 last:border-b-0">
            <span className="flex min-w-0 flex-1 basis-60 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-white text-green [&>svg]:size-4" aria-hidden>
                {starterIcon(starter.id)}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{starter.title}</span>
                <span className="block text-sm leading-5 text-ink-soft">{starter.line}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 pl-11 sm:pl-0">
              <Button size="sm" variant="ghost" onClick={() => onPick(starter, false)} aria-label={`${starter.title}: write my own`}>
                Write my own
              </Button>
              <Tooltip content={`Sample text: ${lowerFirst(starter.exampleLabel)}`}>
                <Button size="sm" variant="secondary" onClick={() => onPick(starter, true)} aria-label={`${starter.title}: try it with an example, ${lowerFirst(starter.exampleLabel)}`}>
                  Try it with an example
                </Button>
              </Tooltip>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 px-1 text-xs leading-4.5 text-ink-50">An example fills the message box with sample text. Edit it or replace it with your own, then press Enter.</p>
      {knowledgeHint && (
        <p className="mt-3 flex items-start justify-center gap-2 px-1 text-left text-sm leading-5 text-ink-soft">
          <LibraryBig className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.75} aria-hidden />
          <span>
            The AI can also use your documents from{' '}
            <Link to="/knowledge" className="rounded-xs font-medium text-green underline-offset-4 hover:underline">
              My secure knowledge
            </Link>
            . Choose them with “Use my knowledge” under the message box.
          </span>
        </p>
      )}
    </div>
  )
}

/** "Notes from a team meeting" inside a sentence: "notes from a team meeting". */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
