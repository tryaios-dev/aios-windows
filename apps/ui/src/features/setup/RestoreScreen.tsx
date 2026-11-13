import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { FolderOpen, KeyRound } from 'lucide-react'
import { RECOVERY_KEY_LENGTH, api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { ZERO_HASH } from '@/lib/hash'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/fields'
import { Callout } from '@/components/ui/feedback'
import { ConfirmDialog } from '@/components/ui/overlays'
import { Hash, KeyValue, Mono } from '@/components/ui/layout'
import { Disclosure, DrawnCheck, IconTile, Plate, Sequence, SetupFrame, StepBody, StepFooter, StepHeading, type RowState } from './SetupFrame'

/**
 * Restore from a backup (MVP 4.5; tickets K-03, E-04). Renders without the
 * app shell. The backup folder is chosen in the system folder dialog.
 */

/** What the person sees. The store works through five technical stages; they map onto these four. */
const STEPS = ['Checking your key', 'Opening your backup', 'Checking nothing is missing', 'Finishing']

/**
 * Moments (ms) at which the first three rows tick while the store works.
 * The five stage timings (900, 2300, 3100, 3600, then the result) become:
 * key derived and matched to the backup at 2300, backup opened at 3100,
 * record checked to its end at 3600, and "Finishing" when the store answers.
 */
const MARKS = [2300, 3100, 3600]
const KEY_LENGTH = RECOVERY_KEY_LENGTH
const GROUPS = KEY_LENGTH / 4
const GROUP_WORDS: Record<number, string> = { 8: 'Eight', 9: 'Nine' }
const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/** Uppercase, letters and digits only, a hyphen after every four characters. */
function formatKey(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, KEY_LENGTH)
  return clean.match(/.{1,4}/g)?.join('-') ?? ''
}

type Failure = 'backup' | 'key' | 'other'

/** The store's message names internal parts. Say the same thing in the product's words. */
function failureOf(error: string): Failure {
  if (/not a complete AIOS backup|no recovery package|no recovery file|has no chats\.db/i.test(error)) return 'backup'
  if (/key/i.test(error)) return 'key'
  return 'other'
}

const FAILURE_TEXT: Record<Failure, string> = {
  backup: 'That folder is not a complete AIOS backup. Choose the folder AIOS made when you backed up. Nothing was changed.',
  key: 'That recovery key does not open this backup. Check it character by character. Nothing was changed.',
  other: 'AIOS could not finish restoring from that backup. Try again. Nothing was changed.',
}

type Phase = 'idle' | 'running' | 'failed' | 'done'
type Help = 'no-backup' | 'lost-key' | null

export function RestoreScreen() {
  const navigate = useNavigate()
  const stream = useStore((s) => s.stream)
  const hasInstallation = useStore((s) => s.ui.firstRunComplete)
  const [folder, setFolder] = useState<string | undefined>(undefined)
  const [key, setKey] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [done, setDone] = useState(0)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [epoch, setEpoch] = useState<number | null>(null)
  const [help, setHelp] = useState<Help>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  const keyLength = key.replace(/-/g, '').length
  const keyComplete = keyLength === KEY_LENGTH
  const running = phase === 'running'
  const finished = phase === 'done'
  const canSubmit = !!folder && keyComplete && !running && !finished

  const resetOutcome = () => {
    if (phase === 'failed') {
      setPhase('idle')
      setDone(0)
      setFailure(null)
    }
  }

  const submit = async () => {
    if (!canSubmit || !folder) return
    clearTimers()
    setPhase('running')
    setDone(0)
    setFailure(null)
    setHelp(null)
    MARKS.forEach((ms, i) => timers.current.push(setTimeout(() => setDone(i + 1), ms)))
    const result = await api.restore({ backup_path: folder, recovery_key: key })
    clearTimers()
    if (result.ok) {
      setDone(STEPS.length)
      setEpoch(result.epoch)
      setPhase('done')
    } else {
      setDone(0)
      setFailure(failureOf(result.error))
      setPhase('failed')
    }
  }

  /** Restoring over an installation that already exists asks first. */
  const tryRestore = () => {
    if (!canSubmit) return
    if (hasInstallation) setConfirmOpen(true)
    else void submit()
  }

  // A wrong key stops at the first row; a folder that is not a backup stops at the second.
  const failedRow = failure === null ? null : failure === 'backup' ? 1 : 0
  const rowState = (i: number): RowState => {
    if (failedRow !== null) return i === failedRow ? 'failed' : 'todo'
    return i < done ? 'done' : i === done && running ? 'current' : 'todo'
  }

  const keyFailed = failure === 'key'

  return (
    <SetupFrame eyebrow="Restore">
      <StepBody className="pb-8">
        <StepHeading className="mb-6" title="Restore from a backup" lede="Choose your backup and enter your recovery key. Nothing on this computer changes until both check out." />

        {!finished && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              tryRestore()
            }}
          >
            <Plate className="flex flex-col gap-6">
              <Field label="Your backup" htmlFor="backup-folder" hint="The folder AIOS made when you backed up.">
                <div className="mt-1 flex items-center gap-3">
                  <IconTile className="size-9">
                    <FolderOpen strokeWidth={1.75} />
                  </IconTile>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Button
                        id="backup-folder"
                        disabled={running}
                        onClick={async () => {
                          const path = await api.chooseBackupFolder()
                          if (path) {
                            setFolder(path)
                            resetOutcome()
                          }
                        }}
                      >
                        {folder ? 'Choose another folder' : 'Choose a folder'}
                      </Button>
                      {folder && <span className="min-w-0 truncate font-mono text-sm text-ink">{folder}</span>}
                    </div>
                </div>
              </Field>

              <div className="h-px bg-line-soft" role="separator" />

              <Field label="Recovery key" htmlFor="recovery-key" hint={`${GROUP_WORDS[GROUPS] ?? GROUPS} groups of four characters. Hyphens are added as you type.`}>
                <div className="mt-1 flex items-center gap-3">
                  <IconTile className="size-9">
                    <KeyRound strokeWidth={1.75} />
                  </IconTile>
                  <div className="relative flex-1">
                    <Input
                      id="recovery-key"
                      mono
                      value={key}
                      onChange={(e) => {
                        setKey(formatKey(e.target.value))
                        resetOutcome()
                      }}
                      placeholder={Array.from({ length: GROUPS }, () => 'XXXX').join('-')}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      disabled={running}
                      aria-invalid={keyFailed || undefined}
                      aria-describedby="recovery-key-count"
                      className="h-12 pr-16 text-md tracking-[0.08em]"
                    />
                    <span id="recovery-key-count" className={cn('pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-2xs tabular', keyComplete ? 'text-green' : 'text-ink-50')} aria-label={`${keyLength} of ${KEY_LENGTH} characters`}>
                      {keyLength}/{KEY_LENGTH}
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-1 pl-12" aria-hidden>
                  {Array.from({ length: GROUPS }, (_, i) => {
                    const fill = Math.max(0, Math.min(1, (keyLength - i * 4) / 4))
                    return (
                      <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-[1px] bg-ink-12">
                        <span className={cn('absolute inset-y-0 left-0 transition-[width,background-color] duration-(--duration-micro)', keyFailed ? 'bg-deny' : 'bg-green')} style={{ width: `${fill * 100}%` }} />
                      </span>
                    )
                  })}
                </div>
              </Field>

              {/* Enter in the key field still submits; the visible button lives in the footer, always in view. */}
              <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
                Restore
              </button>
            </Plate>
          </form>
        )}

        {phase !== 'idle' && (
          <motion.section className="mt-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }} aria-label="Restore progress">
            <Plate tone="paper" className="py-1 sm:py-1">
              <Sequence label="Restore progress" items={STEPS.map((label, i) => ({ label, state: rowState(i) }))} />
            </Plate>
          </motion.section>
        )}

        {phase === 'failed' && failure && (
          <Callout tone="deny" className="mt-5 animate-rise" title="The restore did not finish">
            {FAILURE_TEXT[failure]}
          </Callout>
        )}

        {!running && !finished && (
          <div className="mt-5 px-1">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Button variant="link" className="text-sm" aria-expanded={help === 'no-backup'} aria-controls="restore-help" onClick={() => setHelp((h) => (h === 'no-backup' ? null : 'no-backup'))}>
                I do not have a backup
              </Button>
              <Button variant="link" className="text-sm" aria-expanded={help === 'lost-key'} aria-controls="restore-help" onClick={() => setHelp((h) => (h === 'lost-key' ? null : 'lost-key'))}>
                I have lost my recovery key
              </Button>
            </div>
            <div id="restore-help">
              {help === 'no-backup' && (
                <Plate key="no-backup" tone="paper" className="mt-4 animate-rise">
                  <h2 className="text-base font-semibold leading-6 text-ink">Without a backup, earlier conversations cannot be brought back</h2>
                  <p className="mt-1.5 text-sm leading-5 text-ink-soft">They were kept only on the computer they were made on. AIOS never had a copy.</p>
                  <Button className="mt-4" onClick={() => navigate('/setup')}>
                    Start fresh instead
                  </Button>
                </Plate>
              )}
              {help === 'lost-key' && (
                <Plate key="lost-key" tone="paper" className="mt-4 animate-rise">
                  <h2 className="text-base font-semibold leading-6 text-ink">The backup cannot be opened without the recovery key</h2>
                  <p className="mt-1.5 text-sm leading-5 text-ink-soft">
                    If the old computer still works, open AIOS there and create a new key in Settings › Backup and recovery. Then back up again and restore from that backup with the new key. If it does not, that backup cannot be opened. AIOS has no copy of your key.
                  </p>
                </Plate>
              )}
            </div>
          </div>
        )}

        {finished && epoch !== null && (
          <motion.div className="mt-6 flex flex-col gap-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }}>
            <Plate tone="success" as="section" aria-labelledby="restore-complete">
              <div className="flex items-start gap-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-green text-white" aria-hidden>
                  <DrawnCheck className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id="restore-complete" className="text-xl font-semibold leading-7 text-ink">
                    Your projects and conversations are back.
                  </h2>
                  <ul className="mt-3 flex flex-col gap-1.5 text-sm leading-5 text-ink-soft">
                    <li>The AI model is not part of a backup. AIOS will download it again.</li>
                    <li>The activity record carries on from where the backup ended.</li>
                  </ul>
                </div>
              </div>
            </Plate>

            <Disclosure label="Details">
              <KeyValue
                dense
                rows={[
                  { k: 'Stream', v: <Hash value={stream.stream_id} /> },
                  { k: 'Restored tip', v: <Hash value={stream.prior_tip_hash ?? ZERO_HASH} /> },
                  { k: 'New signing key', v: <Hash value={stream.signer_key_id} /> },
                  { k: 'Epoch', v: <Mono className="tabular text-ink">{epoch}</Mono> },
                  { k: 'Backup', v: <Mono className="break-all text-ink">{folder}</Mono> },
                ]}
              />
              <p className="mt-3 text-xs leading-4.5 text-ink-50">
                This installation writes epoch {epoch} under a new signing key. A signed continuation event references the restored tip. If the original computer keeps writing to its own copy, the stream has two branches from that tip; the verifier reports both and never merges them.
              </p>
            </Disclosure>

          </motion.div>
        )}
      </StepBody>

      {/* The one action for this screen is pinned here, so it is never below the fold. */}
      <StepFooter
        onBack={finished || running ? undefined : () => navigate(hasInstallation ? '/settings/backup' : '/setup')}
        backLabel={hasInstallation ? 'Back to AIOS' : 'Back to setup'}
        note={finished ? 'Restore complete.' : running ? 'Restoring. Keep AIOS open.' : undefined}
        primary={finished ? { label: 'Open AIOS', onClick: () => navigate('/'), arrow: false } : { label: 'Restore', onClick: tryRestore, disabled: !canSubmit, loading: running }}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Replace what is on this computer?"
        description="Conversations made here since that backup will be lost."
        confirmLabel="Replace and restore"
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmOpen(false)
          void submit()
        }}
      />
    </SetupFrame>
  )
}
