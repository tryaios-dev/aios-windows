import { Wordmark } from '@/components/ui/brand'

/**
 * The Windows title bar AIOS has as a desktop application. In the real
 * Electron build this is the window's own frame; the prototype draws it so
 * the designs read as an installed app, not a website. The three window
 * buttons are drawn only: they do nothing here.
 */
export function WindowFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col bg-paper">
      <div className="flex h-8 shrink-0 select-none items-stretch justify-between border-b border-line bg-[#e9e7df]" role="presentation">
        <div className="flex items-center gap-2.5 pl-3">
          <Wordmark height={9} />
          <span className="text-xs leading-none text-ink-50">Your own AI</span>
        </div>
        <div className="flex items-stretch" aria-hidden>
          <span className="flex w-[46px] items-center justify-center text-ink-soft transition-colors duration-(--duration-micro) hover:bg-ink-6">
            <svg viewBox="0 0 10 10" className="size-2.5"><path d="M1 5h8" stroke="currentColor" strokeWidth="1" /></svg>
          </span>
          <span className="flex w-[46px] items-center justify-center text-ink-soft transition-colors duration-(--duration-micro) hover:bg-ink-6">
            <svg viewBox="0 0 10 10" className="size-2.5"><rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          </span>
          <span className="flex w-[46px] items-center justify-center text-ink-soft transition-colors duration-(--duration-micro) hover:bg-[#c42b1c] hover:text-white">
            <svg viewBox="0 0 10 10" className="size-2.5"><path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1" /></svg>
          </span>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}
