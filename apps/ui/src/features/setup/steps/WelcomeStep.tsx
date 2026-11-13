import { useNavigate } from 'react-router'
import { ArrowRight, Check } from 'lucide-react'
import { motion } from 'motion/react'
import { APP_VERSION } from '@/lib/store'
import { Wordmark } from '@/components/ui/brand'
import { Button } from '@/components/ui/button'
import { Vignette, type VignetteKind } from '@/components/app/Vignettes'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/** Staged arrival for the opening screen only: each block settles in turn. */
const arrive = (order: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: EASE, delay: 0.06 + order * 0.07 },
})

const PROMISES = ['Nothing leaves this computer unless you say so', 'Works without the internet', 'No account to create']

/**
 * What AIOS gives you, said as what it does for you, in the order of the
 * menu. The small label is the name the rest of the app uses
 * (docs/GLOSSARY.md), so the words here and the words in the menu match.
 */
const CAPABILITIES: Array<{ kind: VignetteKind; name: string; title: string; line: string }> = [
  { kind: 'model', name: 'AI model', title: 'An AI of your own', line: 'Ask, draft, summarise, think things through. It runs here, even with no internet.' },
  { kind: 'knowledge', name: 'My secure knowledge', title: 'Your documents, under lock and key', line: 'Add your files. AIOS keeps an encrypted copy here, and your AI answers from them.' },
  { kind: 'skills', name: 'Skills', title: 'New abilities when you need them', line: 'Translate, read spreadsheets, write minutes. Add a skill in a click.' },
  { kind: 'resources', name: 'Resources', title: 'More power for bigger jobs', line: 'Borrow a stronger AI model or computer. You approve everything that is sent.' },
  { kind: 'rules', name: 'Rules', title: 'Ground rules, built in', line: 'Four rules from the start. The first: nothing leaves this computer unless you say so.' },
  { kind: 'activity', name: 'Activity', title: 'A record you can check', line: 'What your AI did, in plain words and in order. It holds none of what you wrote.' },
]

/**
 * Step 1, and the first thing anyone sees of AIOS. One idea on the left
 * (an AI that is yours) and, on the right, the six things that make it
 * true, in the order they appear in the menu.
 */
export function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="scroll-stable relative min-h-0 flex-1 overflow-y-auto">
      {/* A little light behind the cards; the page stays paper. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(58%_52%_at_78%_38%,rgba(30,95,70,0.075),transparent_70%)]" />

      <div className="relative mx-auto flex min-h-full w-full max-w-[1200px] flex-col px-6 pb-10 pt-7 sm:px-10">
        {/* The logo is part of the page, not a bar above it, so nothing scrolls underneath it. */}
        <div className="flex shrink-0 items-center justify-between gap-4">
          <Wordmark height={15} />
          <span className="label-mono">AIOS {APP_VERSION} · pilot version</span>
        </div>

        <div className="grid flex-1 items-center gap-x-14 gap-y-12 py-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-6">
        {/* The idea */}
        <header className="max-w-[520px]">
          <motion.p {...arrive(0)} className="label-mono flex items-center gap-2.5 text-green">
            <span aria-hidden className="h-px w-6 bg-green" />
            Welcome to AIOS
          </motion.p>
          <motion.h1 {...arrive(1)} className="font-display mt-5 text-[44px] leading-[1.04] text-ink sm:text-[54px] xl:text-[60px]">
            AI that answers only to you.
          </motion.h1>
          <motion.p {...arrive(2)} className="mt-6 max-w-[46ch] text-lg leading-7 text-ink-soft">
            AIOS is your own AI. It runs on this computer, works from the documents you give it, and keeps everything here unless you choose to send it.
          </motion.p>

          <motion.ul {...arrive(3)} className="mt-7 flex flex-col gap-2.5">
            {PROMISES.map((p) => (
              <li key={p} className="flex items-center gap-3 text-md leading-6 text-ink">
                <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-soft text-green">
                  <Check className="size-3" strokeWidth={2.75} />
                </span>
                {p}
              </li>
            ))}
          </motion.ul>

          <motion.div {...arrive(4)} className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button variant="primary" onClick={onContinue} trailing={<ArrowRight className="size-4 transition-transform duration-(--duration-panel) ease-(--ease-out) group-hover/cta:translate-x-0.5" />} className="group/cta h-12 rounded-lg px-6 text-md">
              Set up AIOS
            </Button>
            <Button variant="link" onClick={() => navigate('/setup/restore')}>
              I have a backup to restore
            </Button>
          </motion.div>
        </header>

        {/* What makes it true */}
        <section aria-label="What comes with AIOS">
          <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {CAPABILITIES.map((c, i) => (
              <motion.li key={c.kind} {...arrive(2 + i)}>
                <article
                  tabIndex={0}
                  className="group/vg flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card outline-none transition-[transform,box-shadow,border-color] duration-(--duration-panel) ease-(--ease-out) hover:-translate-y-0.5 hover:border-green/35 hover:shadow-lift focus-visible:border-green/50 focus-visible:ring-2 focus-visible:ring-green/25"
                >
                  <div className="relative h-[84px] shrink-0 border-b border-line-soft bg-[linear-gradient(180deg,#eef3ee_0%,#f8f8f4_100%)]">
                    <div aria-hidden className="dot-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(70%_90%_at_50%_45%,black,transparent)]" />
                    <Vignette kind={c.kind} className="relative" />
                  </div>
                  <div className="flex flex-1 flex-col px-5 pb-3.5 pt-3">
                    <p className="label-mono text-green">{c.name}</p>
                    <h3 className="mt-0.5 text-md font-semibold leading-6 tracking-[-0.005em] text-ink">{c.title}</h3>
                    <p className="mt-0.5 text-sm leading-5 text-ink-soft">{c.line}</p>
                  </div>
                </article>
              </motion.li>
            ))}
          </ul>
        </section>
        </div>
      </div>
    </div>
  )
}
