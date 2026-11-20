import { useRef } from 'react'
import { Check, FileAudio, Lock, Square, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/feedback'
import { Tooltip } from '@/components/ui/overlays'
import { ACCEPT } from './decodeRecording'
import type { RecordingJob } from './useRecording'

function clock(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/** Beside the microphone while Voice notes is on: pick a recording to turn into text. */
export function RecordingButton({ job, disabled }: { job: RecordingJob; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <Tooltip content="Turn a recording into text">
      <span>
        <button
          type="button"
          aria-label="Turn a recording into text"
          disabled={disabled || job.phase !== 'idle'}
          onClick={() => input.current?.click()}
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-soft transition-[background-color,color,transform] duration-(--duration-micro) ease-(--ease-out) hover:bg-green-wash hover:text-green active:scale-95 disabled:cursor-not-allowed disabled:text-ink-30 disabled:hover:bg-transparent"
        >
          <FileAudio className="size-4" strokeWidth={2} />
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          data-testid="recording-file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // the same file can be picked again
            if (file) job.open(file)
          }}
        />
      </span>
    </Tooltip>
  )
}

/**
 * What the message box shows while a recording becomes text: how far it has got, the text so
 * far, and Stop. Once it is done (or stopped), the text goes into the message box or is thrown
 * away; nothing is sent by itself.
 */
export function RecordingPanel({ job, className }: { job: RecordingJob; className?: string }) {
  const { phase, name, done, total, text, stopped } = job
  const reading = phase === 'reading'
  const ready = phase === 'ready'
  const status = reading ? 'Reading the recording' : ready ? (stopped ? 'Stopped' : 'Turned into text') : 'Turning it into text'
  const lines = text ? text.slice(-600) : ''

  return (
    <div className={cn('px-4 pb-3 pt-3.5', className)}>
      <div className="flex items-center gap-4">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-green text-white">
          {ready ? <Check className="size-4" strokeWidth={2.5} /> : <FileAudio className="size-4" strokeWidth={2} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="label-mono text-green" aria-live="polite">
              {status}
            </span>
            {!reading && (
              <span className="font-mono text-2xs tabular text-ink-50">
                {clock(done)} of {clock(total)}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-soft">{name}</p>
          <Progress className="mt-2" value={total ? (done / total) * 100 : 0} indeterminate={reading} label="Recording turned into text" />
        </div>
      </div>

      <p className="mt-3 max-h-32 min-h-12 overflow-hidden text-md leading-6 text-ink [mask-image:linear-gradient(180deg,transparent,black_30%)]" aria-live="off">
        {lines ? (lines.length < text.length ? `…${lines}` : lines) : <span className="text-ink-50">{reading ? 'One moment…' : 'The text appears here as it is written.'}</span>}
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs leading-4.5 text-ink-50">
          <Lock className="size-3 shrink-0 text-green" strokeWidth={2.25} aria-hidden />
          <span className="truncate">Turned into text on this computer. The recording is not kept.</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {ready ? (
            <>
              <Button size="sm" variant="ghost" onClick={job.discard} leading={<X className="size-3.5" />}>
                Discard
              </Button>
              <Button size="sm" variant="primary" disabled={!text.trim()} onClick={job.take} leading={<Check className="size-3.5" strokeWidth={2.5} />}>
                Put in message
              </Button>
            </>
          ) : reading ? (
            <Button size="sm" variant="ghost" onClick={job.discard}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={job.stop} leading={<Square className="size-3 fill-current" />}>
              Stop
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
