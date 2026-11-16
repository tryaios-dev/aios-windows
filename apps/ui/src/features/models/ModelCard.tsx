import { useId, useState, type ReactNode } from 'react'
import { ArrowUp, Check, ChevronRight, Download, Pause, Play } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useStore } from '@/lib/store'
import type { CatalogueEntry, DownloadState, Hardware, InstalledModel } from '@/lib/types'
import { formatBytes, formatDate, relativeTime } from '@/lib/format'
import { modelLabel, sizeBlurb } from '@/lib/words'
import { modelLogo } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { Button } from '@/components/ui/button'
import { Badge, StatusDot } from '@/components/ui/chips'
import { Hash, KeyValue, Mono } from '@/components/ui/layout'
import { ConfirmDialog } from '@/components/ui/overlays'
import { DownloadMeter } from '@/components/app/InstallProgress'
import { DrawnCheck, Reveal } from '@/features/settings/shared'
import { DeleteModelDialog } from './DeleteModelDialog'
import { useUpdateJourney } from './updateJourney'
import { FIT_TONE, cannotInstallReason, fitFor, needsWords, publisherHost, requirementText, sizeExample, sourceWords } from './modelHelpers'

/**
 * One AI model you can have. Plain facts first: what it is good for with one
 * everyday example, how it runs on this computer, how big it is, and one
 * action. Details gives the precise figures; Verification details inside it
 * keeps the technical record.
 */
export function ModelCard({
  entry,
  installed,
  suggested,
  newerAvailable,
  onSeeUpdate,
  supersededBy,
  newerVersionOf,
}: {
  entry: CatalogueEntry
  installed?: InstalledModel
  /** Mark this one as the suggestion for a first install. The plate above the list carries the primary button. */
  suggested?: boolean
  /** A newer version of this installed AI model is on offer at the top of the page. */
  newerAvailable?: CatalogueEntry
  /** Brings the update at the top of the page into view. */
  onSeeUpdate?: () => void
  /** The newer version is installed as well, so this one is the older of the two. */
  supersededBy?: CatalogueEntry
  /** This entry is a newer version of another AI model in the list. Not the same thing as an alternative model. */
  newerVersionOf?: CatalogueEntry
}) {
  const hardware = useStore((s) => s.hardware)
  const download = useStore((s) => s.downloads[entry.entry_id])
  const inUse = useStore((s) => !!installed && s.settings.default_model_id === installed.id)
  // When the newer version is installed too, removing this one hands new conversations to it.
  const successor = useStore((s) => (supersededBy ? s.installedModels.find((m) => m.catalogue_entry_id === supersededBy.entry_id) : undefined))
  const [removing, setRemoving] = useState(false)
  // The tick draws itself only when the switch was made here, never when the page opens.
  const [switchedHere, setSwitchedHere] = useState(false)

  const fit = fitFor(entry, hardware, !!installed)
  const active = download && download.status !== 'done' ? download : null
  const label = modelLabel(entry)

  const makeDefault = () => {
    if (!installed) return
    api.models.setDefault(installed.id)
    setSwitchedHere(true)
    useStore.getState().toast({ kind: 'success', title: `New conversations will use ${label}`, description: 'Conversations you already have keep the AI model they were using.' })
  }

  return (
    <>
      <article
        className={cn(
          '@container overflow-hidden rounded-xl border bg-white shadow-card transition-[border-color,box-shadow] duration-(--duration-panel) ease-(--ease-out)',
          inUse ? 'border-green/45 ring-1 ring-green/15' : 'border-line ring-1 ring-transparent',
        )}
      >
        <div className="flex flex-col @2xl:flex-row">
          <div className="flex min-w-0 flex-1 items-start gap-4 px-6 py-5">
            {/* The logo of the family the AI model belongs to, so Qwen and Gemma are told apart at a glance. */}
            <ArtTile src={modelLogo(entry.name)} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h3 className="text-md font-semibold text-ink">{label}</h3>
                {inUse && (
                  <Badge tone="green" icon={<Check strokeWidth={2.5} />}>
                    In use
                  </Badge>
                )}
                {installed && !inUse && <Badge tone="neutral">Installed</Badge>}
                {suggested && !installed && <Badge tone="green">Recommended for this computer</Badge>}
                {installed && newerAvailable && (
                  <Badge tone="green" icon={<ArrowUp strokeWidth={2.5} />}>
                    A newer version is available
                  </Badge>
                )}
                {installed && supersededBy && <Badge tone="neutral">Older version</Badge>}
                {newerVersionOf && <Badge tone="neutral">Newer version of {newerVersionOf.name}</Badge>}
              </div>
              <p className="mt-1 max-w-xl text-sm leading-5 text-ink-soft">{sizeBlurb(entry.tier)}</p>
              <p className="mt-2 max-w-xl text-sm leading-5 text-ink">
                <span className="label-mono mr-2">Good for</span>
                {sizeExample(entry.tier)}
              </p>
              <p className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm leading-5">
                <span className={cn('inline-flex items-center gap-2', fit.fit === 'slowly' ? 'text-brass-text' : fit.fit === 'no' ? 'text-ink-soft' : 'text-ink')}>
                  <StatusDot tone={FIT_TONE[fit.fit]} />
                  {fit.line}
                </span>
                <span className="text-ink-30" aria-hidden>
                  ·
                </span>
                <span className="font-mono text-xs tracking-[0.02em] tabular text-ink-soft">{formatBytes(entry.size_bytes)}</span>
              </p>
              {installed && newerAvailable && (
                <p className="mt-2.5 flex max-w-xl flex-wrap items-baseline gap-x-2 text-sm leading-5 text-ink-soft">
                  <span>{newerAvailable.name} is a newer version of this one. This one keeps working, and stays until you choose to remove it.</span>
                  {onSeeUpdate && (
                    <button type="button" onClick={onSeeUpdate} className="rounded-xs font-medium text-green underline-offset-4 hover:underline">
                      See the update
                    </button>
                  )}
                </p>
              )}
              {installed && supersededBy && <p className="mt-2.5 max-w-xl text-sm leading-5 text-ink-soft">{supersededBy.name} is the newer version, and it is installed too. Conversations that used this one keep using it until you change them.</p>}
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col justify-center border-t border-line-soft px-6 py-5 @2xl:w-64 @2xl:border-l @2xl:border-t-0">
            {active ? (
              <DownloadArea entry={entry} download={active} />
            ) : installed ? (
              <div className="flex flex-col gap-2">
                {inUse ? (
                  <p className="flex h-7 items-center justify-center gap-1.5 text-sm font-medium leading-5 text-green">
                    {switchedHere ? <DrawnCheck /> : <Check className="size-4 shrink-0" strokeWidth={2} aria-hidden />}
                    Used for new conversations
                  </p>
                ) : (
                  <Button size="sm" className="w-full" onClick={makeDefault} aria-label={`Use ${label} for new conversations`}>
                    Use this one
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="w-full" onClick={() => setRemoving(true)} aria-label={`Remove ${label}`}>
                  Remove
                </Button>
                <p className="text-center text-xs leading-4.5 text-ink-50 tabular">Installed {relativeTime(installed.installed_at)}</p>
              </div>
            ) : (
              <InstallArea entry={entry} hardware={hardware} canInstall={fit.fit !== 'no'} />
            )}
          </div>
        </div>

        <Details entry={entry} installed={installed} />
      </article>
      {installed && (
        <DeleteModelDialog open={removing} onOpenChange={setRemoving} model={installed} successor={successor} onRemoved={supersededBy ? () => useUpdateJourney.getState().settle(supersededBy.entry_id) : undefined} />
      )}
    </>
  )
}

/* ---------------- Install ---------------- */

function InstallArea({ entry, hardware, canInstall }: { entry: CatalogueEntry; hardware: Hardware; canInstall: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" className="w-full" leading={<Download className="size-3.5" />} disabled={!canInstall} onClick={() => api.models.download(entry.entry_id)} aria-label={`Install ${modelLabel(entry)}`}>
        Install
      </Button>
      {canInstall ? (
        <button type="button" className="self-center rounded-xs text-xs leading-4.5 text-ink-soft underline decoration-line-strong underline-offset-2 transition-colors duration-(--duration-micro) hover:text-green hover:decoration-green" onClick={() => api.models.importOffline(entry.entry_id)}>
          Use a file from my installer
        </button>
      ) : (
        <p className="text-xs leading-4.5 text-ink-soft">{cannotInstallReason(entry, hardware)}</p>
      )}
    </div>
  )
}

/* ---------------- Download states ---------------- */

export function DownloadArea({ entry, download }: { entry: CatalogueEntry; download: DownloadState }) {
  const [confirmStop, setConfirmStop] = useState(false)
  const id = entry.entry_id
  const received = formatBytes(download.received_bytes)

  // Stopping throws away what has arrived, so it asks first.
  const stop = (
    <>
      <Button size="sm" variant="ghost" onClick={() => (download.received_bytes > 0 ? setConfirmStop(true) : api.models.cancel(id))}>
        Cancel
      </Button>
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop this download?"
        description={`The ${received} downloaded so far will be removed.`}
        confirmLabel="Stop download"
        cancelLabel="Keep downloading"
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmStop(false)
          api.models.cancel(id)
        }}
      />
    </>
  )

  if (download.status === 'failed' && download.error_kind === 'damaged') {
    return (
      <div className="flex flex-col gap-2.5" role="alert">
        <p className="text-sm leading-5 text-deny">The file did not pass its check, so AIOS removed it. Nothing from it was kept.</p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" leading={<Download className="size-3.5" />} onClick={() => api.models.download(id)}>
            Download again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => api.models.cancel(id)}>
            Not now
          </Button>
        </div>
      </div>
    )
  }

  // One meter for every other state. Its figures are measured from the bytes received (see InstallProgress).
  const checking = download.status === 'verifying'
  const failed = download.status === 'failed'
  const paused = download.status === 'paused'
  const title = checking ? 'Checking the file' : failed ? 'The connection dropped. What has arrived is saved.' : paused ? 'Paused' : 'Downloading'
  return (
    <div className="flex flex-col gap-2.5" role={failed ? 'alert' : 'status'}>
      <p className={cn('text-sm font-medium leading-5', failed ? 'text-deny' : 'text-ink')}>{title}</p>
      <DownloadMeter download={download} fallbackTotal={entry.size_bytes} />
      {!checking && (
        <div className="flex items-center gap-1.5">
          {failed ? (
            <Button size="sm" variant="primary" leading={<Play className="size-3.5" />} onClick={() => api.models.resume(id)}>
              Carry on
            </Button>
          ) : paused ? (
            <Button size="sm" variant="primary" leading={<Play className="size-3.5" />} onClick={() => api.models.resume(id)}>
              Resume
            </Button>
          ) : (
            <Button size="sm" leading={<Pause className="size-3.5" />} onClick={() => api.models.pause(id)}>
              Pause
            </Button>
          )}
          {stop}
        </div>
      )}
    </div>
  )
}

/* ---------------- Details, and the technical record inside it ---------------- */

function Details({ entry, installed }: { entry: CatalogueEntry; installed?: InstalledModel }) {
  const [open, setOpen] = useState(false)
  const [record, setRecord] = useState(false)
  const id = useId()
  const approval = entry.deviation_approval

  // Second depth: the precise figures, still in everyday terms.
  const facts: Array<{ k: ReactNode; v: ReactNode }> = [
    { k: 'AI model', v: entry.name },
    { k: 'Size on disk', v: <span className="tabular">{formatBytes(entry.size_bytes)}</span> },
    { k: 'What it needs', v: needsWords(entry) },
    { k: 'Licence', v: entry.licence },
  ]
  if (entry.released_at) facts.push({ k: 'Listed', v: <span className="tabular">{formatDate(entry.released_at)}</span> })
  if (!installed) facts.push({ k: 'Comes from', v: `Downloaded directly from its publisher, ${publisherHost(entry)}. AIOS checks it before using it.` })
  if (installed) {
    facts.push({
      k: 'Installed',
      v: (
        <span className="flex flex-col gap-0.5">
          <span className="tabular">{formatDate(installed.installed_at)}</span>
          <span className="text-xs leading-4.5 text-ink-50">{sourceWords(installed.source, entry)}</span>
        </span>
      ),
    })
  }

  // Third depth: engineering vocabulary, unchanged.
  const rows: Array<{ k: ReactNode; v: ReactNode }> = [
    { k: 'Upstream', v: <Mono className="text-ink">{entry.upstream_model}</Mono> },
    { k: 'Revision', v: <Mono className="text-ink">{entry.upstream_revision}</Mono> },
    { k: 'Quantisation', v: <Mono className="text-ink">{entry.quantisation_method}</Mono> },
    {
      k: 'Conversion',
      v: (
        <>
          {entry.conversion_tool} · <Mono>{entry.conversion_version}</Mono>
        </>
      ),
    },
    { k: 'Context length', v: <Mono className="tabular text-ink">{entry.context_length.toLocaleString('en-GB')} tokens</Mono> },
    { k: 'Minimum hardware', v: requirementText(entry) },
    {
      k: 'Licence',
      v: (
        <>
          {entry.licence} · <Mono>{entry.licence_reference}</Mono>
        </>
      ),
    },
    { k: 'Publisher', v: entry.publisher },
    { k: 'Download source', v: <Mono className="break-all text-ink">{entry.mirror_url}</Mono> },
    { k: 'Provenance', v: entry.pipeline === 'own' ? 'Own quantisation pipeline' : 'Third-party artefact, reviewed before listing' },
    { k: 'Source weights digest', v: entry.source_weight_digest ? <Hash value={entry.source_weight_digest} head={10} tail={6} /> : 'Not published by the model’s maker' },
    { k: 'Artefact digest', v: <Hash value={entry.artifact_digest} head={10} tail={6} /> },
    { k: 'File', v: <Mono className="break-all text-ink">{installed ? installed.file_path : entry.file_name}</Mono> },
  ]
  if (approval) {
    rows.push({
      k: 'Deviation approval',
      v: (
        <span className="flex flex-col gap-0.5">
          <span>
            {approval.reviewer} · {formatDate(approval.date)}
          </span>
          <span className="text-xs leading-4.5 text-ink-50">{approval.quality_threshold_result}</span>
        </span>
      ),
    })
  }

  return (
    <div className="border-t border-line-soft bg-paper-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        data-state={open ? 'open' : 'closed'}
        className="group flex h-9 w-full items-center gap-1.5 px-6 text-left text-sm font-medium text-ink-soft transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-ink-6 hover:text-ink"
        aria-label={`Details for ${modelLabel(entry)}`}
      >
        <ChevronRight className="size-3.5 text-ink-50 transition-transform duration-(--duration-panel) ease-(--ease-out) group-data-[state=open]:rotate-90" strokeWidth={2} aria-hidden />
        Details
      </button>
      <Reveal open={open} id={id}>
        <div className="border-t border-line-soft px-6 pb-4 pt-3.5">
          <p className="mb-2 flex items-center gap-2 text-sm leading-5 text-ink">
            <Check className="size-3.5 shrink-0 text-green" strokeWidth={2.5} aria-hidden />
            {installed ? 'Checked: genuine, unmodified file' : 'AIOS checks it is the genuine, unmodified file before using it.'}
          </p>
          <KeyValue dense rows={facts} className="max-w-2xl" />

          <button
            type="button"
            onClick={() => setRecord((v) => !v)}
            aria-expanded={record}
            aria-controls={`${id}-record`}
            data-state={record ? 'open' : 'closed'}
            className="group -ml-2 mt-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors duration-(--duration-micro) ease-(--ease-out) hover:bg-ink-6"
          >
            <ChevronRight className="size-3.5 text-ink-50 transition-transform duration-(--duration-panel) ease-(--ease-out) group-data-[state=open]:rotate-90" strokeWidth={2} aria-hidden />
            <span className="label-mono group-hover:text-ink-soft">Verification details</span>
          </button>
          <Reveal open={record} id={`${id}-record`}>
            <div className="pt-1">
              <KeyValue dense rows={rows} className="max-w-2xl" />
              <p className="mt-3 text-xs leading-4.5 text-ink-50">Both digests are verified against the signed catalogue before the file is used.</p>
            </div>
          </Reveal>
        </div>
      </Reveal>
    </div>
  )
}
