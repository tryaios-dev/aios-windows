import { useState, type ReactNode, type Ref } from 'react'
import { Check, Download } from 'lucide-react'
import { ART, modelLogo } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useStore } from '@/lib/store'
import type { CatalogueEntry, DownloadState, InstalledModel } from '@/lib/types'
import { formatBytes, formatDate, relativeTime } from '@/lib/format'
import { modelLabel } from '@/lib/words'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/chips'
import { StageTrack, type Stage } from '@/components/app/InstallProgress'
import { DrawnCheck } from '@/features/settings/shared'
import { DeleteModelDialog } from './DeleteModelDialog'
import { DownloadArea } from './ModelCard'
import { FIT_TONE, cannotInstallReason, fitFor, publisherHost } from './modelHelpers'
import { useUpdateJourney, type ModelUpdateState } from './updateJourney'

/**
 * A newer version of an installed AI model, from the news to the result.
 *
 *   offer     what is new, when it was listed, its size and how it runs here, and one button: Update.
 *   updating  the download and the check, in the open. The current AI model keeps answering throughout.
 *   ready     the new one has passed its check. Two decisions are left, and neither is taken for the person:
 *             whether new conversations use it, and whether the old one stays.
 *
 * Nothing here is automatic except the download and the check the person asked for.
 */
export function ModelUpdate({ update, sectionRef }: { update: ModelUpdateState; sectionRef?: Ref<HTMLElement> }) {
  const { entry, current, newer, phase } = update
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="models-update"
      className="@container scroll-mt-6 overflow-hidden rounded-xl border border-green/45 bg-white shadow-card ring-1 ring-green/15 focus:outline-none"
    >
      {/* Keyed on the stage, so each one arrives with a short fade and nothing slides. */}
      <div key={phase} className="animate-fade">
        {phase === 'ready' && newer ? <Ready entry={entry} current={current} newer={newer} /> : phase === 'updating' ? <Updating entry={entry} current={current} /> : <Offer entry={entry} current={current} />}
      </div>
    </section>
  )
}

/* ---------------- The news ---------------- */

function Offer({ entry, current }: { entry: CatalogueEntry; current: InstalledModel }) {
  const hardware = useStore((s) => s.hardware)
  const fit = fitFor(entry, hardware, false)
  const canInstall = fit.fit !== 'no'

  const start = () => {
    useUpdateJourney.getState().start(entry.entry_id)
    api.models.download(entry.entry_id)
  }

  return (
    <>
      <div className="flex flex-col @3xl:flex-row">
        <div className="flex min-w-0 flex-1 items-start gap-4 p-6">
          <ArtTile src={modelLogo(entry.name)} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="label-mono">News</div>
            <h2 id="models-update" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
              A newer version of your AI model is out
            </h2>
            <p className="mt-1.5 max-w-lg text-sm leading-5 text-ink-soft">
              <span className="font-semibold text-ink">{modelLabel(entry)}</span> is a newer version of {modelLabel(current)}, the one you have installed.
            </p>
            {entry.whats_new && (
              <p className="mt-3 max-w-lg text-sm leading-5 text-ink">
                <span className="label-mono mr-2">What is new</span>
                {entry.whats_new}
              </p>
            )}
          </div>
        </div>

        <dl className="grid shrink-0 grid-cols-1 divide-y divide-line-soft border-t border-line-soft bg-paper-raised @md:grid-cols-3 @md:divide-x @md:divide-y-0 @3xl:w-80 @3xl:grid-cols-1 @3xl:divide-x-0 @3xl:divide-y @3xl:border-l @3xl:border-t-0">
          {entry.released_at && (
            <Fact label="Listed">
              <span className="block text-sm font-medium leading-5 text-ink tabular">{sentenceCase(relativeTime(entry.released_at))}</span>
              <span className="mt-0.5 block text-xs leading-4.5 text-ink-50 tabular">{formatDate(entry.released_at)}</span>
            </Fact>
          )}
          <Fact label="Size">
            <span className="block text-sm font-medium leading-5 text-ink tabular">{formatBytes(entry.size_bytes)}</span>
            <span className="mt-0.5 block text-xs leading-4.5 text-ink-50 tabular">This computer has {hardware.free_disk_gb} GB free.</span>
          </Fact>
          <Fact label="On this computer">
            <span className={cn('flex items-center gap-2 text-sm font-medium leading-5', fit.fit === 'slowly' ? 'text-brass-text' : fit.fit === 'no' ? 'text-ink-soft' : 'text-ink')}>
              <StatusDot tone={FIT_TONE[fit.fit]} />
              {fit.line}
            </span>
            {!canInstall && <span className="mt-0.5 block text-xs leading-4.5 text-ink-50">{cannotInstallReason(entry, hardware)}</span>}
          </Fact>
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-line-soft px-6 py-4">
        <div className="min-w-[min(100%,20rem)] flex-1 text-sm leading-5 text-ink-soft">
          <p>
            Update downloads it from its publisher, {publisherHost(entry)}, and checks it is the genuine, unmodified file. <span className="font-medium text-ink">{modelLabel(current)} keeps working until the new one has passed its check.</span>
          </p>
          <p className="mt-1">Your conversations are not touched, and nothing changes in My secure knowledge. Afterwards you choose whether to keep the old one.</p>
        </div>
        <Button variant="primary" size="lg" className="shrink-0" leading={<Download className="size-4" />} disabled={!canInstall} onClick={start} aria-label={`Update to ${modelLabel(entry)}`}>
          Update <span className="font-normal opacity-80 tabular">· {formatBytes(entry.size_bytes)}</span>
        </Button>
      </div>
    </>
  )
}

/* ---------------- Downloading and checking ---------------- */

function stagesFor(download: DownloadState | undefined): Stage[] {
  const status = download?.status
  const damaged = status === 'failed' && download?.error_kind === 'damaged'
  const first: Stage['state'] = status === 'verifying' || damaged ? 'done' : status === 'paused' ? 'paused' : status === 'failed' ? 'failed' : 'current'
  const second: Stage['state'] = status === 'verifying' ? 'current' : damaged ? 'failed' : 'todo'
  return [
    { id: 'download', label: 'Download', state: first },
    { id: 'check', label: 'Check it is genuine', state: second },
    { id: 'ready', label: 'Ready to use', state: 'todo' },
  ]
}

function Updating({ entry, current }: { entry: CatalogueEntry; current: InstalledModel }) {
  const download = useStore((s) => s.downloads[entry.entry_id])

  return (
    <>
      <div className="flex items-start gap-4 p-6">
        <ArtTile src={modelLogo(entry.name)} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="label-mono">Update under way</div>
          <h2 id="models-update" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
            Updating to {modelLabel(entry)}
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-5 text-ink-soft">
            <span className="font-medium text-ink">{modelLabel(current)} keeps working while this runs.</span> Nothing changes until the new one has passed its check.
          </p>
        </div>
      </div>
      <div className="border-t border-line-soft bg-paper-raised px-6 py-5">
        <StageTrack stages={stagesFor(download)} className="max-w-2xl" />
        {download && (
          <div className="mt-5 max-w-2xl">
            <DownloadArea entry={entry} download={download} />
          </div>
        )}
      </div>
    </>
  )
}

/* ---------------- The result ---------------- */

function Ready({ entry, current, newer }: { entry: CatalogueEntry; current: InstalledModel; newer: InstalledModel }) {
  const usingNew = useStore((s) => s.settings.default_model_id === newer.id)
  const usingOld = useStore((s) => s.settings.default_model_id === current.id)
  // The tick draws itself only when the switch was made here, never when the page opens.
  const [switchedHere, setSwitchedHere] = useState(false)
  const [removing, setRemoving] = useState(false)
  const freed = formatBytes(current.size_bytes)
  const settle = () => useUpdateJourney.getState().settle(entry.entry_id)

  const useIt = () => {
    api.models.setDefault(newer.id)
    setSwitchedHere(true)
  }

  const keep = () => {
    const inUse = useStore.getState().installedModels.find((m) => m.id === useStore.getState().settings.default_model_id)
    settle()
    useStore.getState().toast({
      kind: 'success',
      title: 'Both AI models are kept',
      description: `${inUse ? `New conversations use ${modelLabel(inUse)}. ` : ''}You can remove ${modelLabel(current)} at any time from its card.`,
    })
  }

  return (
    <>
      <div className="flex items-start gap-4 p-6">
        <ArtTile src={ART.done} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="label-mono">Update installed</div>
          <h2 id="models-update" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
            {entry.name} is ready. Your conversations are untouched.
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-5 text-ink-soft">It passed its check: genuine, unmodified file. Two things are left for you to decide.</p>
        </div>
      </div>

      <div className="divide-y divide-line-soft border-t border-line-soft">
        <Decision
          title="New conversations"
          detail={
            usingNew ? (
              <span className="flex items-center gap-1.5 font-medium text-green">
                {switchedHere ? <DrawnCheck /> : <Check className="size-4 shrink-0" strokeWidth={2} aria-hidden />}
                New conversations use {modelLabel(newer)}.
              </span>
            ) : usingOld ? (
              `They still use ${modelLabel(current)}. Nothing switches until you say so.`
            ) : (
              'They use a different AI model at the moment. Nothing switches until you say so.'
            )
          }
        >
          {!usingNew && (
            <Button variant="primary" onClick={useIt}>
              Use it for new conversations
            </Button>
          )}
        </Decision>
        <Decision title={`The old one, ${modelLabel(current)}`} detail={`It is still installed and takes ${freed}. Keep it to compare the two, or remove it to free the space. You can install it again at any time.`}>
          <Button onClick={keep}>Keep the old one too</Button>
          <Button onClick={() => setRemoving(true)} aria-label={`Remove the old one, ${modelLabel(current)}. Frees ${freed}.`}>
            Remove the old one <span className="font-normal text-ink-50 tabular">· frees {freed}</span>
          </Button>
        </Decision>
      </div>

      <div className="border-t border-line-soft bg-paper-raised px-6 py-4">
        <div className="label-mono">What happens to everything else</div>
        <ul className="mt-2.5 flex max-w-3xl flex-col gap-2">
          {[
            'Conversations you already have keep the AI model they were using until you change it. You can change it inside any conversation.',
            'If you remove the old one, a conversation that used it will ask which AI model to carry on with. Nothing in the conversation is lost.',
            'Nothing changes in My secure knowledge. Your documents stay exactly as they are.',
          ].map((text) => (
            <li key={text} className="flex items-start gap-2.5 text-sm leading-5 text-ink-soft">
              <Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <DeleteModelDialog open={removing} onOpenChange={setRemoving} model={current} successor={newer} onRemoved={settle} />
    </>
  )
}

/* ---------------- Pieces ---------------- */

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-6 py-4">
      <dt className="label-mono">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  )
}

/** One decision: what it is about and where it stands on the left, the choice on the right. */
function Decision({ title, detail, children }: { title: string; detail: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-4">
      <div className="min-w-[min(100%,18rem)] flex-1">
        <div className="text-sm font-semibold leading-5 text-ink">{title}</div>
        <div className="mt-0.5 max-w-xl text-sm leading-5 text-ink-soft" aria-live="polite">
          {detail}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
