import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Lock, Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/layout'
import { Tooltip } from '@/components/ui/overlays'
import type { Dictation } from './useDictation'
import { platform } from '@/lib/platform'

const BARS = 56

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** The button that starts it. Sits beside Send. */
export function MicButton({ onClick, disabled, round, className }: { onClick: () => void; disabled?: boolean; /** Match a round Send button. */ round?: boolean; className?: string }) {
  return (
    <Tooltip content="Speak instead of typing">
      <span>
        <button
          type="button"
          aria-label="Speak instead of typing"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          className={cn(
            'voice-mic inline-flex items-center justify-center text-ink-soft transition-[background-color,color,transform] duration-(--duration-micro) ease-(--ease-out) hover:bg-green-wash hover:text-green active:scale-95 disabled:cursor-not-allowed disabled:text-ink-30 disabled:hover:bg-transparent',
            round ? 'size-9 rounded-full' : 'size-8 rounded-md',
            className,
          )}
        >
          <Mic className="size-4" strokeWidth={2} />
        </button>
      </span>
    </Tooltip>
  )
}

/**
 * What the message box becomes while you speak: a microphone that moves with
 * your voice, the sound as it arrives, and your words written out as they are
 * heard. A pause finishes it; Done finishes it sooner; Cancel throws it away.
 */
export function VoicePanel({ dictation, className }: { dictation: Dictation; className?: string }) {
  const { phase, words, seconds, level, finish, cancel, start } = dictation
  const bars = useRef<HTMLDivElement>(null)
  const ringNear = useRef<HTMLSpanElement>(null)
  const ringFar = useRef<HTMLSpanElement>(null)
  const done = useRef<HTMLButtonElement>(null)
  const listening = phase === 'listening'

  // The sound, drawn straight onto the page each frame so React is not asked to redraw sixty times a second.
  useEffect(() => {
    if (!listening) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const history = new Array<number>(BARS).fill(0.04)
    let frame = 0
    let last = 0
    let far = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const v = level.current ?? 0
      far += (v - far) * 0.12
      if (!still) {
        if (ringNear.current) ringNear.current.style.transform = `scale(${1 + v * 0.42})`
        if (ringFar.current) ringFar.current.style.transform = `scale(${1 + far * 0.95})`
      }
      if (now - last < 48) return
      last = now
      history.push(v)
      history.shift()
      const nodes = bars.current?.children
      if (!nodes || still) return
      for (let i = 0; i < nodes.length; i++) {
        ;(nodes[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.07, history[i])})`
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [listening, level])

  // Enter finishes, Escape cancels, wherever the cursor is.
  useEffect(() => {
    if (phase !== 'starting' && phase !== 'listening') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        finish()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, cancel, finish])

  useEffect(() => {
    if (phase === 'starting') done.current?.focus({ preventScroll: true })
  }, [phase])

  if (phase === 'no-mic') {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4', className)} role="alert">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full border border-brass/30 bg-brass-soft text-brass-text">
          <MicOff className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-[min(100%,16rem)] flex-1">
          <p className="text-sm font-semibold leading-5 text-ink">AIOS cannot find a microphone</p>
          <p className="mt-0.5 text-sm leading-5 text-ink-soft">Plug one in, or check it is switched on in {platform.soundSettings}. You can keep typing in the meantime.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={cancel}>
            Close
          </Button>
          <Button size="sm" onClick={start}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const writing = phase === 'writing'
  const status = phase === 'starting' ? 'Starting the microphone' : writing ? 'Writing it out' : 'Listening'

  return (
    <div className={cn('px-4 pb-3 pt-3.5', className)}>
      <div className="flex items-center gap-4">
        {/* The microphone. Its rings open and close with the voice. */}
        <span aria-hidden className="relative flex size-11 shrink-0 items-center justify-center">
          <span ref={ringFar} className="absolute inset-0 rounded-full bg-green/10 transition-opacity duration-(--duration-panel)" style={{ opacity: listening ? 1 : 0 }} />
          <span ref={ringNear} className="absolute inset-0.5 rounded-full bg-green/15 transition-opacity duration-(--duration-panel)" style={{ opacity: listening ? 1 : 0 }} />
          <span className={cn('relative flex size-9 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_3px_rgba(22,33,27,0.25)] transition-colors duration-(--duration-panel)', phase === 'starting' ? 'voice-wake bg-green/70' : 'bg-green')}>
            {writing ? <Check className="voice-pop size-4" strokeWidth={2.5} /> : <Mic className="size-4" strokeWidth={2} />}
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="label-mono text-green" aria-live="polite">
              {status}
            </span>
            <span className="font-mono text-2xs tabular text-ink-50">{clock(seconds)}</span>
          </div>
          {/* The sound: newest on the right, fading as it moves left. */}
          <div className="relative mt-1.5 h-8 overflow-hidden">
            <div ref={bars} className={cn('flex h-full items-center justify-between transition-opacity duration-(--duration-panel) [mask-image:linear-gradient(90deg,transparent,black_28%)]', writing && 'opacity-0')}>
              {Array.from({ length: BARS }, (_, i) => (
                <span key={i} className="h-full w-[3px] origin-center rounded-full bg-green will-change-transform" style={{ transform: 'scaleY(0.07)' }} />
              ))}
            </div>
            {writing && <span className="voice-sweep absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full" />}
          </div>
        </div>
      </div>

      {/* The words, as they are heard. */}
      <p className="mt-3 min-h-12 text-md leading-6 text-ink" aria-live="off">
        {words.length === 0 ? (
          <span className="text-ink-50">{phase === 'starting' ? 'One moment…' : 'Start speaking. Your words appear here.'}</span>
        ) : (
          <>
            {words.map((word, i) => (
              <span key={i} className="voice-word">
                {word}{' '}
              </span>
            ))}
            {listening && <span aria-hidden className="voice-caret -ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-[3px] rounded-full bg-green" />}
          </>
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs leading-4.5 text-ink-50">
          <Lock className="size-3 shrink-0 text-green" strokeWidth={2.25} aria-hidden />
          <span className="truncate">Turned into text on this computer</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" disabled={writing} onClick={cancel} trailing={<Kbd>Esc</Kbd>}>
            Cancel
          </Button>
          <Button ref={done} size="sm" variant="primary" disabled={writing || words.length === 0} onClick={finish} leading={<Check className="size-3.5" strokeWidth={2.5} />}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The line above the message box once spoken words are in it. */
export function FromVoiceNote({ onClear }: { onClear: () => void }) {
  return (
    <div className="animate-fade flex items-center gap-2 border-b border-dashed border-line px-4 py-1.5 text-xs text-ink-50">
      <Mic className="size-3.5 shrink-0 text-green" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 truncate" role="status">
        Written from what you said. Check it reads right, then press Enter.
      </span>
      <button type="button" onClick={onClear} className="shrink-0 rounded-sm px-1 font-medium text-ink-soft transition-colors duration-(--duration-micro) hover:text-ink">
        Clear
      </button>
    </div>
  )
}

/**
 * Lets its contents change height smoothly, so the message box opens into the
 * listening panel and closes again instead of jumping.
 */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div className={cn('overflow-hidden transition-[height] duration-[260ms] ease-(--ease-out)', className)} style={height === null ? undefined : { height }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}
