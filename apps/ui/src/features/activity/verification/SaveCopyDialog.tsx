import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Collapsible } from 'radix-ui'
import { Check, ChevronDown, Copy, FileCheck2, FolderOpen, Terminal } from 'lucide-react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { EvidenceEvent, EvidenceExportResult, Project } from '@/lib/types'
import { cn } from '@/lib/cn'
import { formatBytes, formatTimestamp } from '@/lib/format'
import { Button, IconButton } from '@/components/ui/button'
import { StatusDot, type DotTone } from '@/components/ui/chips'
import { Field, Hint, Input, RadioCard, RadioGroup } from '@/components/ui/fields'
import { Callout, Progress, Spinner } from '@/components/ui/feedback'
import { Hash, KeyValue, Mono, SectionLabel, useCopy } from '@/components/ui/layout'
import { Dialog, Tooltip } from '@/components/ui/overlays'
import { formatSeqRange } from './eventMeta'

type Scope = 'all' | 'project' | 'range'
type Phase = { kind: 'form' } | { kind: 'working' } | { kind: 'done'; result: EvidenceExportResult } | { kind: 'error'; message: string }

const DEFAULT_FOLDER = 'C:\\Users\\pilot\\Documents\\AIOS exports'

const VERDICTS: Array<{ verdict: string; tone: DotTone; meaning: string }> = [
  { verdict: 'intact', tone: 'green', meaning: 'Every hash and signature checks out from the first sequence to the expected tip.' },
  { verdict: 'altered', tone: 'deny', meaning: 'A hash or signature fails.' },
  { verdict: 'truncated', tone: 'deny', meaning: 'Events stop before the manifest\u2019s last sequence.' },
  { verdict: 'branched', tone: 'brass', meaning: 'Two continuations of one tip.' },
  { verdict: 'unknown signer', tone: 'brass', meaning: 'A signature verifies under a key the manifest does not name.' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayStartIso = (day: string) => new Date(`${day}T00:00:00`).toISOString()
const dayEndIso = (day: string) => new Date(`${day}T23:59:59.999`).toISOString()

/**
 * "Save a verifiable copy": a signed, content-free evidence package for everything recorded,
 * one project, or a date range (K-09, F-07). Opened from Verification details, so the technical
 * content stays; the first paragraph says what the file is in plain words.
 * `project` is the project in view, if any; `projectEvents` are its events plus the device-level ones.
 */
export function SaveCopyDialog({ open, onOpenChange, project, projectEvents }: { open: boolean; onOpenChange: (open: boolean) => void; project?: Project; projectEvents: EvidenceEvent[] }) {
  const allEvents = useStore((s) => s.events)
  const checkpoints = useStore((s) => s.checkpoints)

  const [scope, setScope] = useState<Scope>(project ? 'project' : 'all')
  const [from, setFrom] = useState(() => localDay(new Date(Date.now() - 7 * 86400000)))
  const [to, setTo] = useState(() => localDay(new Date()))
  const [folder, setFolder] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })

  const hasProjectEvents = !!project && projectEvents.length > 0
  const first = hasProjectEvents ? Math.min(...projectEvents.map((e) => e.seq)) : 0
  const last = hasProjectEvents ? Math.max(...projectEvents.map((e) => e.seq)) : 0

  useEffect(() => {
    if (!open) return
    setScope(hasProjectEvents ? 'project' : 'all')
    setFrom(localDay(new Date(Date.now() - 7 * 86400000)))
    setTo(localDay(new Date()))
    setFolder('')
    setPhase({ kind: 'form' })
    // Reset once per opening; the project's event count is read at that moment on purpose.

  }, [open])

  const rangeInvalid = from > to
  const fromIso = dayStartIso(from)
  const toIso = dayEndIso(to)

  const projectRangeCount = useMemo(() => (hasProjectEvents ? allEvents.filter((e) => e.seq >= first && e.seq <= last).length : 0), [allEvents, first, last, hasProjectEvents])
  const dateRangeCount = useMemo(() => (rangeInvalid ? 0 : allEvents.filter((e) => e.ts >= fromIso && e.ts <= toIso).length), [allEvents, fromIso, toIso, rangeInvalid])
  const selectedCount = scope === 'all' ? allEvents.length : scope === 'project' ? projectRangeCount : dateRangeCount
  const selectedCheckpoints = useMemo(() => {
    if (selectedCount === 0) return 0
    const inScope = scope === 'all' ? allEvents : scope === 'project' ? allEvents.filter((e) => e.seq >= first && e.seq <= last) : allEvents.filter((e) => e.ts >= fromIso && e.ts <= toIso)
    const lo = inScope[0]?.seq ?? 0
    const hi = inScope[inScope.length - 1]?.seq ?? 0
    return checkpoints.filter((c) => c.seq_to >= lo && c.seq_from <= hi).length
  }, [allEvents, checkpoints, scope, first, last, fromIso, toIso, selectedCount])

  const canExport = phase.kind === 'form' && folder.length > 0 && selectedCount > 0 && !(scope === 'range' && rangeInvalid)

  const run = async () => {
    if (!canExport) return
    setPhase({ kind: 'working' })
    try {
      // "Everything" is the date range from the first recorded event to now; the endpoint takes a project or a range.
      const everything = { from: allEvents.reduce((min, e) => (e.ts < min ? e.ts : min), allEvents[0].ts), to: new Date().toISOString() }
      const result = await api.projects.exportEvidence(scope === 'all' ? everything : scope === 'project' && project ? { project_id: project.id } : { from: fromIso, to: toIso })
      setPhase({ kind: 'done', result })
      useStore.getState().toast({ kind: 'success', title: 'Verifiable copy saved', description: `${result.file_name} · ${formatBytes(result.size_bytes)}. Saving it is now part of the activity record.` })
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'The file could not be written.' })
    }
  }

  const working = phase.kind === 'working'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && working) return
        onOpenChange(o)
      }}
      width="lg"
      hideClose={working}
      title={phase.kind === 'done' ? 'Verifiable copy saved' : 'Save a verifiable copy'}
      description={
        phase.kind === 'done'
          ? `Saved to ${folder}. Give the file to anyone who needs to check it. They need nothing else from this computer.`
          : 'This saves one file that lists what was recorded and carries everything needed to prove none of it has been changed. It holds no conversation content. Anyone can check it without AIOS.'
      }
      footer={
        phase.kind === 'done' ? (
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        ) : phase.kind === 'error' ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            <Button variant="primary" onClick={() => setPhase({ kind: 'form' })}>Back to options</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>Cancel</Button>
            <Button variant="primary" onClick={run} disabled={!canExport} loading={working}>
              Save copy
            </Button>
          </>
        )
      }
    >
      {phase.kind === 'form' && (
        <div className="flex flex-col gap-6">
          <Field label="What to include" hint="The chain cannot skip, so a copy is always a contiguous run of sequence numbers.">
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="flex flex-col gap-2" aria-label="What to include">
              {project && (
                <RadioCard
                  value="project"
                  title={`This project: ${project.name}`}
                  disabled={!hasProjectEvents}
                  meta={hasProjectEvents ? `${projectRangeCount} ${projectRangeCount === 1 ? 'event' : 'events'}` : 'no events yet'}
                  description={
                    hasProjectEvents
                      ? `A contiguous range from the project\u2019s first to its last event, ${formatSeqRange(first, last)}. Events from other projects inside that range come along because the chain cannot skip; they are content-free.`
                      : 'Nothing has been recorded for this project yet. Choose everything or a date range instead.'
                  }
                />
              )}
              <RadioCard
                value="all"
                title="Everything on this computer"
                disabled={allEvents.length === 0}
                meta={`${allEvents.length} ${allEvents.length === 1 ? 'event' : 'events'}`}
                description="The whole stream, from the first event to the latest, whichever project each belongs to."
              />
              <RadioCard value="range" title="Date range" meta={rangeInvalid ? undefined : `${dateRangeCount} ${dateRangeCount === 1 ? 'event' : 'events'}`} description="Every event in the stream between two dates, inclusive, whichever project it belongs to." />
            </RadioGroup>
            {scope === 'range' && (
              <div className="mt-1 grid grid-cols-2 gap-3 rounded-lg border border-line bg-paper p-3 animate-in">
                <Field label="From" htmlFor="evidence-export-from">
                  <Input id="evidence-export-from" type="date" mono value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="To" htmlFor="evidence-export-to" error={rangeInvalid ? 'The end date is before the start date.' : dateRangeCount === 0 ? 'No events in this range.' : undefined}>
                  <Input id="evidence-export-to" type="date" mono value={to} min={from} aria-invalid={rangeInvalid || undefined} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
            )}
          </Field>

          <Field label="Where to save it" htmlFor="evidence-export-folder" hint="The file is written to this folder on this computer. Nothing is uploaded.">
            <div className="flex gap-2">
              <Input id="evidence-export-folder" mono readOnly value={folder} placeholder="Choose a folder" className="flex-1" />
              <Button variant="secondary" leading={<FolderOpen className="size-3.5" aria-hidden />} onClick={() => setFolder(DEFAULT_FOLDER)}>
                Choose folder
              </Button>
            </div>
          </Field>

          <div className="flex items-center gap-3 border-t border-line-soft pt-4">
            <span className="label-mono shrink-0">Package</span>
            <Hint className="text-ink-soft">
              {selectedCount > 0 ? `${selectedCount} ${selectedCount === 1 ? 'event' : 'events'} and ${selectedCheckpoints} ${selectedCheckpoints === 1 ? 'checkpoint' : 'checkpoints'} will be packaged with the signer keys needed to check them.` : 'Choose a range that contains at least one event.'}
            </Hint>
          </div>
        </div>
      )}

      {phase.kind === 'working' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status" aria-live="polite">
          <Spinner className="size-5" label="Saving" />
          <p className="text-sm font-medium text-ink">Assembling events, checkpoints and signer keys; signing the manifest</p>
          <p className="text-xs text-ink-50">
            {selectedCount} {selectedCount === 1 ? 'event' : 'events'} · {selectedCheckpoints} {selectedCheckpoints === 1 ? 'checkpoint' : 'checkpoints'} · <span className="font-mono">{folder}</span>
          </p>
          <Progress value={0} indeterminate label="Saving the copy" className="mt-2 w-64" />
        </div>
      )}

      {phase.kind === 'error' && (
        <Callout tone="deny" title="The file could not be saved">
          {phase.message} Nothing was changed and nothing was recorded. Check that AIOS can write to the folder, then try again.
        </Callout>
      )}

      {phase.kind === 'done' && <ExportResult result={phase.result} />}
    </Dialog>
  )
}

function ExportResult({ result }: { result: EvidenceExportResult }) {
  const count = result.last_seq >= result.first_seq && result.first_seq > 0 ? result.last_seq - result.first_seq + 1 : 0
  const [epochFrom, epochTo] = result.epoch_range
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [verdictsOpen, setVerdictsOpen] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      {/* Success plate: the three things the holder needs to know */}
      <div className="rounded-lg border border-green/25 bg-green-wash">
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <FileCheck2 className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm text-ink" title={result.path}>
              {result.file_name}
            </div>
            <div className="mt-0.5 font-mono text-2xs leading-4 text-ink-50 tabular">
              {formatBytes(result.size_bytes)} · {result.scope} · {formatTimestamp(result.exported_at)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-green/15 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <Fact caption="Range">
            <span className="font-mono text-base tabular text-ink">{formatSeqRange(result.first_seq, result.last_seq)}</span>
            {count > 0 && <span className="font-mono text-xs text-ink-50 tabular">{count} {count === 1 ? 'event' : 'events'}</span>}
          </Fact>
          <Fact caption="Expected tip">
            <Hash value={result.expected_tip} full className="text-2xs leading-4 text-ink" />
          </Fact>
        </div>
      </div>

      {/* Verify */}
      <div>
        <SectionLabel>Verify without AIOS</SectionLabel>
        <p className="mt-1.5 text-sm leading-5 text-ink-soft">Run the verifier against the file. It needs no network and no account; the keys it checks against are inside the manifest.</p>
        <CommandBox command={`aios-verify ${result.file_name}`} className="mt-2.5" />

        <Collapsible.Root open={verdictsOpen} onOpenChange={setVerdictsOpen} className="mt-3">
          <Collapsible.Trigger asChild>
            <button type="button" className="group inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-sm font-medium text-ink-soft transition-colors duration-(--duration-micro) hover:bg-ink-6 hover:text-ink">
              <ChevronDown className="size-3.5 transition-transform duration-(--duration-panel) ease-(--ease-out) group-data-[state=open]:rotate-180" aria-hidden />
              What the verifier reports
            </button>
          </Collapsible.Trigger>
          <Collapsible.Content className="animate-in">
            <ul className="mt-2 divide-y divide-line-soft rounded-md border border-line bg-paper-raised" aria-label="Verifier verdicts">
              {VERDICTS.map((v) => (
                <li key={v.verdict} className="grid grid-cols-[132px_1fr] items-baseline gap-3 px-3 py-2">
                  <span className="flex items-center gap-2 font-mono text-xs text-ink">
                    <StatusDot tone={v.tone} />
                    {v.verdict}
                  </span>
                  <span className="text-sm leading-5 text-ink-soft">{v.meaning}</span>
                </li>
              ))}
            </ul>
          </Collapsible.Content>
        </Collapsible.Root>
      </div>

      {/* Manifest details, folded */}
      <Collapsible.Root open={detailsOpen} onOpenChange={setDetailsOpen} className="border-t border-line-soft pt-3">
        <Collapsible.Trigger asChild>
          <button type="button" className="group inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-sm font-medium text-ink-soft transition-colors duration-(--duration-micro) hover:bg-ink-6 hover:text-ink">
            <ChevronDown className="size-3.5 transition-transform duration-(--duration-panel) ease-(--ease-out) group-data-[state=open]:rotate-180" aria-hidden />
            Manifest details
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content className="animate-in">
          <KeyValue
            dense
            className="mt-2"
            rows={[
              { k: 'Path', v: <Mono className="break-all text-ink">{result.path}</Mono> },
              { k: 'Stream', v: <Hash value={result.stream_id} head={8} tail={4} className="text-ink" /> },
              { k: 'Epoch range', v: <Mono className="text-ink">{epochFrom === epochTo ? epochFrom : `${epochFrom}–${epochTo}`}</Mono> },
              {
                k: 'Signer key ids',
                v: (
                  <span className="flex flex-col gap-1">
                    {result.signer_key_ids.map((id) => (
                      <Hash key={id} value={id} head={12} tail={8} className="text-ink" />
                    ))}
                  </span>
                ),
              },
              {
                k: 'Checkpoints included',
                v: result.checkpoint_ids.length ? (
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="tabular">{result.checkpoint_ids.length}</span>
                    <Mono>{result.checkpoint_ids.join(', ')}</Mono>
                  </span>
                ) : (
                  <span className="text-ink-soft">None in this range</span>
                ),
              },
              { k: 'Custody', v: result.custody },
            ]}
          />
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

function Fact({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="label-mono">{caption}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">{children}</span>
    </div>
  )
}

function CommandBox({ command, className }: { command: string; className?: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className={cn('flex items-center gap-2 rounded-md border border-line bg-paper-sunk py-1.5 pr-1.5 pl-3', className)}>
      <Terminal className="size-3.5 shrink-0 text-ink-50" aria-hidden />
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{command}</code>
      <Tooltip content={copied ? 'Copied' : 'Copy command'}>
        <IconButton label="Copy command" size="sm" onClick={() => copy(command)}>
          {copied ? <Check className="text-green" /> : <Copy />}
        </IconButton>
      </Tooltip>
    </div>
  )
}
