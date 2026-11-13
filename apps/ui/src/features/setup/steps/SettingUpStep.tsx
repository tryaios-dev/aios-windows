import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Pause, Play, RotateCw } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { ModelTier } from '@/lib/types'
import { formatBytes, formatDuration, formatSpeed } from '@/lib/format'
import { modelLabel } from '@/lib/words'
import { AIOS_PARTS, type AiosPart } from '@/data/stack'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Hash, KeyValue, Mono } from '@/components/ui/layout'
import { DrawnTick, ProgressBar, timeLeftWords, useTransferStats } from '@/components/app/InstallProgress'
import { Vignette } from '@/components/app/Vignettes'
import { Disclosure, Plate, StepBody, StepFooter, StepHeading } from '../SetupFrame'
import { GIB, WORKING_SPACE_BYTES, availableTiers, spaceNeededGb, tierEntry } from '../tiers'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/*
 * No internet is not simulated in the prototype. When the real application
 * cannot reach the model's publisher, this step shows, in place of the
 * progress block:
 *
 *   Title:  "AIOS cannot reach the place the AI model comes from."
 *   Body:   "Check that this computer is online, then carry on. Nothing has
 *            been lost. If a model file came with your installer, AIOS can
 *            use that instead."
 *   Button: "Try again"
 *   Link:   "Use the model file that came with my installer instead"
 *
 * "Skip for now" stays available, as it does everywhere on this step.
 */

/**
 * Step 3. Starts by itself, and shows everything AIOS is putting on this
 * computer, not only the AI model: a checklist that grows one line at a
 * time above a single progress bar, with a small drawing of the part being
 * added right now.
 *
 * What is real and what is staged:
 *   - The AI model line and the progress bar follow the download the
 *     backend reports (bytes received, paused, dropped, checked). In the
 *     prototype that backend is simulated.
 *   - The other lines are ticked at set points along the way. They say what
 *     the installation includes; they are not tied to separate backend
 *     steps yet. Engineering has to confirm the list (src/data/stack.ts)
 *     and, where a step is real, tick its line from the real event.
 */
type ModelState = 'adding' | 'checking' | 'paused' | 'dropped' | 'damaged' | 'no-space' | 'skipped' | 'ready'

export function SettingUpStep({ note, tier, skipped, onSkip, onUnskip, onBack, onContinue }: { note?: string; tier: ModelTier; skipped: boolean; onSkip: () => void; onUnskip: () => void; onBack: () => void; onContinue: () => void }) {
  const entry = tierEntry(tier)
  const entryId = entry.entry_id
  const hw = useStore((s) => s.hardware)
  const download = useStore((s) => s.downloads[entryId])
  const installed = useStore((s) => s.installedModels.some((m) => m.id === entryId))
  const installedSource = useStore((s) => s.installedModels.find((m) => m.id === entryId)?.source)
  const [fromFile, setFromFile] = useState(false)
  // How far along the checklist is, 0 to 100. Replay mode arrives with the model installed: show it finished.
  const [shown, setShown] = useState(installed ? 100 : 0)
  const started = useRef(false)
  const stats = useTransferStats(download, entry.size_bytes)

  const needGb = spaceNeededGb(entry)
  const enoughSpace = installed || hw.free_disk_gb * GIB >= entry.size_bytes + WORKING_SPACE_BYTES
  const toFreeGb = Math.max(1, needGb - hw.free_disk_gb)

  const start = () => {
    if (enoughSpace) api.models.download(entryId)
  }

  // Start once, by itself. A download left paused or interrupted by an earlier visit is shown as it is.
  useEffect(() => {
    if (started.current) return
    started.current = true
    // A download begun for the other size is no longer wanted.
    const inFlight = useStore.getState().downloads
    for (const other of availableTiers().map((t) => tierEntry(t).entry_id)) {
      if (other !== entryId && inFlight[other]) api.models.cancel(other)
    }
    if (installed || skipped || download || !enoughSpace) return
    api.models.download(entryId)
    // The ref keeps this to one start, whatever changes afterwards.
  }, [installed, skipped, download, entryId, enoughSpace])

  const status = download?.status
  const verifying = status === 'verifying'
  const failed = status === 'failed'
  const damaged = failed && download?.error_kind === 'damaged'
  const paused = status === 'paused'
  const downloading = status === 'downloading'

  const model: ModelState = installed ? 'ready' : skipped ? 'skipped' : !download && !enoughSpace ? 'no-space' : verifying ? 'checking' : damaged ? 'damaged' : failed ? 'dropped' : paused ? 'paused' : 'adding'

  // While the AI model arrives, the checklist keeps pace with it.
  useEffect(() => {
    if (downloading) setShown((v) => Math.max(v, stats.pct * 0.96))
  }, [downloading, stats.pct])

  // With nothing left to download (being checked, already here, or skipped) the remaining lines follow at a steady pace.
  const coasting = verifying || installed || skipped
  useEffect(() => {
    if (!coasting) return
    const t = setInterval(() => setShown((v) => (v >= 100 ? 100 : Math.min(100, v + 2.4))), 110)
    return () => clearInterval(t)
  }, [coasting])

  const finished = (installed || skipped) && shown >= 100
  const moving = downloading || coasting
  const others = AIOS_PARTS.filter((p) => p.id !== 'model')
  const modelPart = AIOS_PARTS.find((p) => p.id === 'model')!
  const done = (p: AiosPart) => shown >= p.at
  const current = others.find((p) => !done(p))
  const readyCount = others.filter(done).length + (installed ? 1 : 0)
  const total = AIOS_PARTS.length - (skipped ? 1 : 0)
  // The drawing shows what is being added right now: the next small part, then the AI model itself.
  const featured: AiosPart = current ?? modelPart
  const percent = finished ? 100 : Math.min(99, Math.floor(shown))

  const useInstallerFile = () => {
    api.models.cancel(entryId)
    setFromFile(true)
    api.models.importOffline(entryId)
  }

  const skip = () => {
    // Keep what has arrived so far; it can be carried on later from AI models.
    if (downloading) api.models.pause(entryId)
    onSkip()
  }

  const resumeAfterSkip = () => {
    onUnskip()
    if (download && status !== 'downloading') {
      if (damaged) api.models.download(entryId)
      else api.models.resume(entryId)
    } else if (!download) start()
  }

  const canUseFile = !installed && !verifying && !skipped && (!!download || !enoughSpace)
  const canSkip = !installed && !verifying && !skipped

  const copied = fromFile || installedSource === 'offline'
  const figures =
    model === 'adding'
      ? [`${formatBytes(stats.received)} of ${formatBytes(stats.total)}`, stats.speedBps !== null ? formatSpeed(stats.speedBps) : 'connecting', stats.etaSeconds !== null ? `${timeLeftWords(stats.etaSeconds).toLowerCase()} left` : 'working out the time left'].join(' · ')
      : null

  // The AI model line says what is true of the model right now.
  const modelLine: { title: string; detail: string } = {
    adding: { title: copied ? 'Copying your AI model' : modelPart.adding, detail: figures ?? modelLabel(entry) },
    checking: { title: 'Checking your AI model', detail: 'Making sure it is the genuine, unmodified file' },
    paused: { title: 'Download paused', detail: `${formatBytes(stats.received)} of ${formatBytes(stats.total)} is saved` },
    dropped: { title: 'The connection dropped', detail: `${formatBytes(stats.received)} has arrived and is saved` },
    damaged: { title: 'The AI model did not pass its check', detail: 'AIOS removed it. Nothing from it was kept' },
    'no-space': { title: 'Not enough free space for the AI model', detail: `It needs ${needGb} GB free. This computer has ${hw.free_disk_gb} GB` },
    skipped: { title: 'No AI model for now', detail: 'You can add one later from AI models' },
    ready: { title: modelPart.ready, detail: `${modelLabel(entry)}, ${formatBytes(entry.size_bytes)}` },
  }[model]

  const modelRowState: RowState = model === 'ready' ? 'done' : model === 'adding' || model === 'checking' ? 'current' : model === 'paused' ? 'paused' : model === 'skipped' ? 'skipped' : 'failed'

  // One sentence and one button for anything that needs the person.
  let attention: { tone: 'brass' | 'deny'; text: string; action: React.ReactNode } | null = null
  if (model === 'paused') attention = { tone: 'brass', text: 'What has arrived is saved. Resume when you are ready.', action: <Button size="sm" variant="primary" leading={<Play className="size-3.5" />} onClick={() => api.models.resume(entryId)}>Resume</Button> }
  else if (model === 'dropped') attention = { tone: 'deny', text: 'Check that this computer is online, then carry on from where it stopped.', action: <Button size="sm" variant="primary" leading={<RotateCw className="size-3.5" />} onClick={() => api.models.resume(entryId)}>Carry on</Button> }
  else if (model === 'damaged') attention = { tone: 'deny', text: 'It was damaged or changed on the way. Downloading again usually fixes this.', action: <Button size="sm" variant="primary" leading={<RotateCw className="size-3.5" />} onClick={() => api.models.download(entryId)}>Download again</Button> }
  else if (model === 'no-space') attention = { tone: 'deny', text: `Free about ${toFreeGb} GB, then try again. Nothing has been downloaded yet.`, action: <Button size="sm" variant="primary" leading={<RotateCw className="size-3.5" />} onClick={start}>Try again</Button> }
  else if (model === 'skipped' && enoughSpace) attention = { tone: 'brass', text: 'AIOS will open without chat until an AI model is added.', action: <Button size="sm" onClick={resumeAfterSkip}>{download && !damaged ? 'Carry on downloading' : 'Download it now'}</Button> }

  return (
    <>
      <StepBody className="pb-6 lg:pt-9">
        <StepHeading className="mb-5" note={note} title="Setting up" lede="AIOS is putting everything in place. You can leave it running." />

        <div className="flex flex-col gap-4">
          <Plate as="section" aria-label="Installation" className="overflow-hidden p-0 sm:p-0">
            {/* What is being added right now */}
            <div className="flex min-h-[112px] items-stretch border-b border-line-soft">
              <div className="relative hidden w-[212px] shrink-0 border-r border-line-soft bg-[linear-gradient(180deg,#eef3ee_0%,#f8f8f4_100%)] sm:block">
                <div aria-hidden className="dot-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(70%_85%_at_50%_50%,black,transparent)]" />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={finished ? 'ready' : featured.id} className="absolute inset-0 flex items-center justify-center px-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.3, ease: EASE }}>
                    {finished ? (
                      <span className="flex size-14 items-center justify-center rounded-full bg-green text-white shadow-[0_10px_24px_-10px_rgba(30,95,70,0.7)]">
                        <DrawnTick className="size-6" />
                      </span>
                    ) : (
                      <Vignette kind={featured.id} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center px-5 py-3 sm:px-6" role="status" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={finished ? 'ready' : featured.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.26, ease: EASE }}>
                    {finished ? (
                      <>
                        <p className="label-mono text-green">All done</p>
                        <h2 className="mt-1 text-xl font-semibold leading-7 tracking-[-0.01em] text-ink">Your AIOS is ready</h2>
                        <p className="mt-1 text-sm leading-5 text-ink-soft">{skipped ? 'Everything is in place except an AI model, which you can add at any time.' : 'Everything below is now on this computer, and it works with no internet.'}</p>
                      </>
                    ) : (
                      <>
                        <p className="label-mono text-green">{moving ? 'Adding now' : 'Waiting'}</p>
                        <h2 className="mt-1 text-xl font-semibold leading-7 tracking-[-0.01em] text-ink">{featured.name}</h2>
                        <p className="mt-1 text-sm leading-5 text-ink-soft">{featured.why}</p>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* The list grows as each part is put in place. Its height is held, so nothing jumps as lines arrive. */}
            <ol className="flex min-h-[272px] flex-col px-5 py-2 sm:px-6" aria-label="What is on this computer so far">
              {others.map((p) => {
                const isDone = done(p)
                const isCurrent = !isDone && current?.id === p.id
                if (!isDone && !isCurrent) return null
                return <Row key={p.id} state={isDone ? 'done' : moving ? 'current' : 'paused'} title={isDone ? p.ready : p.adding} detail={isDone ? p.detail : undefined} />
              })}
              <Row state={modelRowState} title={modelLine.title} detail={modelLine.detail} live={model === 'adding'} />
            </ol>

            {/* One progress bar for the whole installation */}
            <div className="border-t border-line-soft bg-paper-raised/70 px-5 py-3.5 sm:px-6">
              <div className="flex items-center gap-4">
                <p className="flex w-[72px] shrink-0 items-baseline font-mono leading-none tabular text-ink" aria-hidden>
                  <span className="text-[30px] font-medium tracking-[-0.03em]">{percent}</span>
                  <span className="ml-0.5 text-base text-ink-50">%</span>
                </p>
                <ProgressBar value={finished ? 100 : shown} tone={attention?.tone === 'deny' ? 'deny' : model === 'paused' ? 'brass' : 'green'} active={moving && !finished} label="Setting up AIOS" valueText={`${percent} percent. ${readyCount} of ${total} ready.`} />
                <p className="shrink-0 text-sm leading-5 tabular text-ink-soft">
                  <span className="font-medium text-ink">{readyCount}</span> of {total} ready
                </p>
                {model === 'adding' && downloading && (
                  <Button size="sm" variant="ghost" leading={<Pause className="size-3.5" />} onClick={() => api.models.pause(entryId)} className="-mr-2 shrink-0">
                    Pause
                  </Button>
                )}
              </div>
              {attention && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft pt-3" role={attention.tone === 'deny' ? 'alert' : 'status'}>
                  <p className="flex min-w-0 items-center gap-2.5 text-sm leading-5 text-ink">
                    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', attention.tone === 'deny' ? 'bg-deny' : 'bg-brass')} />
                    {attention.text}
                  </p>
                  <div className="shrink-0">{attention.action}</div>
                </div>
              )}
            </div>
          </Plate>

          {(canUseFile || canSkip) && (
            <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-1 text-sm leading-5">
              {canUseFile && (
                <Button variant="link" className="text-sm" onClick={useInstallerFile}>
                  Use the model file that came with my installer
                </Button>
              )}
              {canSkip && (
                <Button variant="link" className="text-sm text-ink-soft" onClick={skip}>
                  Skip the AI model for now
                </Button>
              )}
            </p>
          )}

          <Disclosure label="Details">
            <KeyValue
              dense
              rows={[
                { k: 'AI model', v: modelLabel(entry) },
                { k: 'File', v: <Mono className="break-all text-ink">{entry.file_name}</Mono> },
                { k: 'Size', v: <Mono className="tabular text-ink">{formatBytes(entry.size_bytes)} · {entry.size_bytes.toLocaleString('en-GB')} bytes</Mono> },
                { k: 'Downloaded from', v: <Mono className="text-ink">{new URL(entry.mirror_url).host}</Mono>, hint: 'Directly from the model’s publisher' },
                ...(downloading
                  ? [
                      { k: 'Speed', v: <Mono className="tabular text-ink">{stats.speedBps !== null ? formatSpeed(stats.speedBps) : 'connecting'}</Mono> },
                      { k: 'Time left', v: <Mono className="tabular text-ink">{stats.etaSeconds !== null ? formatDuration(stats.etaSeconds) : '—'}</Mono> },
                    ]
                  : []),
                { k: 'Resumes', v: 'Yes. An interrupted download carries on from the last byte received.' },
                { k: 'File check', v: 'SHA-256 digest of the file matches the signed catalogue entry' },
                { k: 'Expected digest', v: <Hash value={entry.artifact_digest} /> },
                { k: 'Quantisation', v: <Mono className="text-ink">{entry.quantisation_method}</Mono> },
                { k: 'Licence', v: entry.licence },
              ]}
            />
          </Disclosure>
        </div>
      </StepBody>
      <StepFooter onBack={onBack} primary={{ label: 'Continue', onClick: onContinue, disabled: !finished }} />
    </>
  )
}

type RowState = 'done' | 'current' | 'paused' | 'failed' | 'skipped'

/** One line of the checklist. It arrives with a short fade and its tick is drawn in. */
function Row({ state, title, detail, live }: { state: RowState; title: string; detail?: string; /** The detail is a running figure, not a description. */ live?: boolean }) {
  return (
    <motion.li className="flex h-8 items-center gap-3" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
      <span
        aria-hidden
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-(--duration-panel)',
          state === 'done' && 'border-green bg-green text-white',
          state === 'current' && 'border-green/40 bg-white',
          state === 'paused' && 'border-brass bg-brass-soft',
          state === 'failed' && 'border-deny bg-deny-soft',
          state === 'skipped' && 'border-line bg-paper-raised',
        )}
      >
        {state === 'done' && <DrawnTick className="size-2.5" strokeWidth={2.75} />}
        {state === 'current' && <span className="size-2 animate-spin rounded-full border-[1.5px] border-green border-t-transparent" />}
        {state === 'paused' && <span className="size-1.5 rounded-[1px] bg-brass" />}
        {state === 'failed' && <span className="size-1.5 rounded-full bg-deny" />}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-x-2.5">
        <span className={cn('shrink-0 text-sm leading-5', state === 'done' ? 'font-medium text-ink' : state === 'failed' ? 'font-medium text-deny' : state === 'skipped' ? 'text-ink-soft' : 'font-medium text-ink')}>
          {title}
          <span className="sr-only">{state === 'done' ? ' (ready)' : state === 'current' ? ' (in progress)' : state === 'paused' ? ' (on hold)' : state === 'failed' ? ' (stopped)' : ''}</span>
        </span>
        {detail && <span className={cn('min-w-0 truncate text-sm leading-5 text-ink-50', live && 'tabular')} aria-live={live ? 'off' : undefined}>{detail}</span>}
      </span>
    </motion.li>
  )
}
