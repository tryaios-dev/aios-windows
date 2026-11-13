import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, Check, FolderOpen, Info, RotateCcw, Save } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useStore } from '@/lib/store'
import type { BackupResult } from '@/lib/types'
import { formatBytes, formatDateTime, pluralise, relativeTime } from '@/lib/format'
import { backupStatus } from '@/lib/words'
import { Button } from '@/components/ui/button'
import { StatusDot, type DotTone } from '@/components/ui/chips'
import { Hint, Label } from '@/components/ui/fields'
import { Callout, Progress } from '@/components/ui/feedback'
import { Ledger, PanelNote, PathValue, SettingGroup, SettingPanel, SettingRow } from './SettingRow'
import { Advanced, DrawnCheck, Reveal, StatementList } from './shared'
import { RecoveryKeyDialog } from './RecoveryKeyDialog'
import { platform } from '@/lib/platform'

const HOLDS = ['Your projects and conversations', 'Your secure knowledge (the copies AIOS keeps of your documents)', 'The activity record', 'What is needed to open them with your recovery key']

const WORST: Array<{ situation: string; outcome: string; tone: DotTone }> = [
  { situation: 'This computer breaks. You have a backup and your key.', outcome: 'Everything comes back on a new computer.', tone: 'green' },
  { situation: 'This computer breaks. You have no backup.', outcome: 'Your conversations are gone. AIOS has no copy.', tone: 'deny' },
  { situation: 'You lose the key. This computer still works.', outcome: 'Create a new key here, then back up.', tone: 'brass' },
  { situation: 'You lose the key and this computer.', outcome: 'The backup cannot be opened.', tone: 'deny' },
]

const DATA_ROOT = platform.folders.root

const PATHS: Array<{ path: string; purpose: string }> = [
  { path: 'data\\chats.db', purpose: 'Projects, conversations, messages and summaries. Encrypted with SQLCipher.' },
  { path: 'data\\evidence.db', purpose: 'The append-only evidence log. Commitments and hashes, never content.' },
  { path: 'data\\recovery.pkg', purpose: 'Recovery Package v1. With the recovery key, what a clean machine needs to restore.' },
  { path: 'backups\\', purpose: 'A copy of the database taken before every migration. Not a substitute for a backup elsewhere.' },
  { path: 'logs\\', purpose: 'Operational logs. Kept for 14 days or 20 MB.' },
]

type Outcome = { ok: true; result: BackupResult } | { ok: false; error: string }

/**
 * Backup and recovery (decisions D3, D4). The one section that keeps work safe:
 * the status and "Back up now" first, then where backups go, what they hold,
 * the recovery key, restore, and what happens when things go wrong.
 */
export function BackupSection() {
  const settings = useStore((s) => s.settings)
  const navigate = useNavigate()
  const [choosing, setChoosing] = useState(false)
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [keyDialog, setKeyDialog] = useState({ open: false, run: 0 })

  const location = settings.backup_location
  const status = backupStatus(settings)
  const sameDisk = !!location && /^c:/i.test(location)

  const backUp = async () => {
    setRunning(true)
    setOutcome(null)
    try {
      setOutcome(await api.backup.run())
    } catch {
      setOutcome({ ok: false, error: 'Something stopped the backup before it finished. Try again. Nothing was changed.' })
    } finally {
      setRunning(false)
    }
  }

  const afterNewKey = () => {
    setKeyDialog((d) => ({ ...d, open: false }))
    if (location) void backUp()
    else setChoosing(true)
  }

  return (
    <>
      {/* ---------------- Status ---------------- */}
      <section aria-labelledby="backup-status" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-5 p-6">
          <div className="flex min-w-[min(100%,18rem)] flex-1 items-start gap-4">
            <ArtTile src={status.tone === 'ok' ? ART.backup : status.tone === 'none' ? ART.backupMissing : ART.warning} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="label-mono">Your backup</div>
              <h3 id="backup-status" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink tabular">
                {status.label}
              </h3>
              {status.tone !== 'ok' && status.detail && <p className="mt-1 text-sm font-medium leading-5 text-brass-text">{status.detail}</p>}
              <p className="mt-2 max-w-md text-sm leading-5 text-ink-soft">A backup is a copy of your projects, conversations and secure knowledge, kept somewhere other than this computer. If this computer breaks or is lost, you get them back from the backup with your recovery key.</p>
            </div>
          </div>
          <div className="shrink-0">
            {location ? (
              <Button variant="primary" size="lg" leading={<Save className="size-4" />} loading={running} onClick={backUp}>
                {running ? 'Backing up…' : 'Back up now'}
              </Button>
            ) : (
              <Button variant="primary" size="lg" leading={<FolderOpen className="size-4" />} onClick={() => setChoosing(true)} aria-expanded={choosing} aria-controls="backup-choose">
                Choose where backups go
              </Button>
            )}
          </div>
        </div>

        <Reveal open={choosing && !location} id="backup-choose">
          <div className="flex flex-col gap-1.5 border-t border-line-soft px-6 py-4">
            <Label htmlFor="backup-choose-select">Choose a folder for your backups</Label>
            <DestinationSelect id="backup-choose-select" value={location} className="max-w-sm" />
            <Hint>A USB drive or a network folder is safest. You can change this at any time.</Hint>
          </div>
        </Reveal>

        <div aria-live="polite">
          <Reveal open={running || !!outcome}>
            <div className="border-t border-line-soft px-6 py-4">
              {running && (
                <>
                  <Progress indeterminate value={0} label="Backing up" />
                  <p className="mt-2.5 text-xs leading-4.5 text-ink-50">Copying your projects, conversations, secure knowledge and the activity record.</p>
                </>
              )}
              {!running && outcome?.ok && (
                <div className="flex items-start gap-3 animate-fade">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-green text-white">
                    <DrawnCheck className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 text-sm leading-5">
                    <p className="font-medium text-ink">
                      Backed up. <span className="font-normal text-ink-soft tabular">{pluralise(outcome.result.conversations, 'conversation')}, {formatBytes(outcome.result.size_bytes)}.</span>
                    </p>
                    <p className="mt-0.5 text-ink-soft">
                      Saved to <PathValue value={outcome.result.path} className="align-baseline" />
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" className="-my-1 shrink-0" onClick={() => setOutcome(null)}>
                    Dismiss
                  </Button>
                </div>
              )}
              {!running && outcome && !outcome.ok && (
                <Callout
                  tone="deny"
                  title="No backup was made"
                  action={
                    location ? (
                      <Button size="sm" onClick={backUp}>
                        Try again
                      </Button>
                    ) : undefined
                  }
                >
                  {outcome.error}
                </Callout>
              )}
            </div>
          </Reveal>
        </div>

        <dl className="grid grid-cols-1 divide-y divide-line-soft border-t border-line-soft bg-paper-raised sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] sm:divide-x sm:divide-y-0">
          <Fact label="Goes to">{location ? <span className="break-all font-mono text-xs tracking-[0.02em]">{location}</span> : <span className="text-ink-50">Not chosen yet</span>}</Fact>
          <Fact label="Last backup">
            {settings.last_backup_at ? (
              <span key={settings.last_backup_at} className="inline-block animate-fade tabular">
                {formatDateTime(settings.last_backup_at)}
              </span>
            ) : (
              <span className="text-ink-50">Never</span>
            )}
          </Fact>
          <Fact label="Size">
            {settings.last_backup_size ? (
              <span key={settings.last_backup_size} className="inline-block animate-fade font-mono text-xs tracking-[0.02em] tabular">
                {formatBytes(settings.last_backup_size)}
              </span>
            ) : (
              <span className="text-ink-50">Nothing yet</span>
            )}
          </Fact>
        </dl>
      </section>

      {/* ---------------- Where backups go ---------------- */}
      <SettingGroup title="Where backups go">
        <SettingPanel>
          <SettingRow
            htmlFor="backup-destination"
            label="Backup folder"
            hint="A USB drive or a network folder is safest. Each backup is saved there with its date in the name."
            control={<DestinationSelect id="backup-destination" value={location} className="w-72 max-w-full" />}
          />
          {sameDisk && (
            <PanelNote tone="caution" icon={<AlertTriangle />}>
              This folder is on the same disk as AIOS. If that disk fails, the backup is lost with everything else. Choose a USB drive or a network folder.
            </PanelNote>
          )}
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- What a backup holds ---------------- */}
      <SettingGroup title="What a backup holds">
        <SettingPanel>
          <StatementList mark={<Check strokeWidth={2} />} items={HOLDS} />
          <PanelNote icon={<Info />}>
            <p>AI models are not included. They are large and AIOS can download them again.</p>
            <p className="mt-1">Your original document files are not touched by a backup. They stay where you keep them.</p>
            <p className="mt-1">A backup is a copy at one moment. Work you do afterwards is not in it until you back up again.</p>
          </PanelNote>
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- Recovery key ---------------- */}
      <SettingGroup title="Your recovery key">
        <SettingPanel>
          <div className="flex items-start gap-4 px-5 py-4">
            <ArtTile src={ART.recoveryKey} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium leading-[1.375rem] text-ink">If this computer is lost or stops working, this key opens your backup on another one.</p>
              <p className="mt-1 text-sm leading-5 text-ink-soft">The key is not a backup. It opens one. You need both.</p>
            </div>
          </div>
          {/* The hard truth is always here. It is tinted only while there is no recent backup to fall back on. */}
          <div className={cn('flex items-start gap-3 px-5 py-3', status.tone === 'ok' ? 'bg-paper-raised' : 'bg-brass-soft')}>
            <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', status.tone === 'ok' ? 'text-ink-50' : 'text-brass-text')} strokeWidth={1.75} aria-hidden />
            <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-ink">If this computer fails and you have no backup, your conversations are gone. AIOS has no copy.</p>
          </div>
          <SettingRow
            label={<span className="tabular">{settings.recovery_key_issued_at ? `Created ${relativeTime(settings.recovery_key_issued_at)}` : 'Not created yet'}</span>}
            hint="AIOS does not keep this key. It was shown once. If you no longer have it, create a new one."
            control={<Button onClick={() => setKeyDialog((d) => ({ open: true, run: d.run + 1 }))}>Create a new recovery key</Button>}
          />
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- Restore ---------------- */}
      <SettingGroup title="Restore">
        <SettingPanel>
          <SettingRow
            label="Restore from a backup"
            hint="Replaces what is on this computer with a backup. Have the backup and your recovery key to hand."
            control={
              <Button leading={<RotateCcw className="size-3.5" />} onClick={() => navigate('/setup/restore')}>
                Restore
              </Button>
            }
          />
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- If the worst happens ---------------- */}
      <SettingGroup title="If the worst happens" description="Four situations, and what each one means for your work.">
        <SettingPanel>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft bg-paper-raised">
                <th scope="col" className="label-mono h-9 w-1/2 px-5 text-left font-normal">
                  If
                </th>
                <th scope="col" className="label-mono h-9 px-5 text-left font-normal">
                  Then
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {WORST.map((w) => (
                <tr key={w.situation} className="align-top">
                  <th scope="row" className="px-5 py-3.5 text-left font-normal leading-5 text-ink-soft">
                    {w.situation}
                  </th>
                  <td className="px-5 py-3.5">
                    <span className="flex items-start gap-2.5">
                      <StatusDot tone={w.tone} className="mt-1.5" />
                      <span className="font-medium leading-5 text-ink">{w.outcome}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- Advanced ---------------- */}
      <Advanced summary="File locations and encryption">
        <SettingGroup
          title="Where your AIOS data is kept"
          description={
            <>
              Everything is under <PathValue value={DATA_ROOT} /> on this computer.
            </>
          }
        >
          <SettingPanel>
            <Ledger cols="grid-cols-[minmax(160px,34%)_1fr]" rows={PATHS.map((p) => ({ rawKey: true, k: <PathValue value={p.path} copyValue={DATA_ROOT + p.path} />, v: <span className="text-ink-soft">{p.purpose}</span> }))} />
          </SettingPanel>
        </SettingGroup>
        <SettingGroup title="Encryption">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'Conversations', v: 'chats.db is encrypted at rest with SQLCipher.' },
                { k: 'Database key', v: `Held in ${platform.keyStore} for your ${platform.account}. Never written to a file.` },
                { k: 'Recovery key', v: 'Not stored. It unwraps the keys in recovery.pkg when a backup is restored.' },
                { k: 'Activity record', v: 'evidence.db holds commitments and hashes, never content.' },
              ]}
            />
          </SettingPanel>
        </SettingGroup>
      </Advanced>

      <RecoveryKeyDialog key={keyDialog.run} open={keyDialog.open} onOpenChange={(open) => setKeyDialog((d) => ({ ...d, open }))} hasDestination={!!location} onBackUp={afterNewKey} />
    </>
  )
}

/* ---------------- Pieces ---------------- */

/** The backup folder. Backup has no backend yet (proposed: POST /backup), so choosing one says so. */
function DestinationSelect({ id, value, className }: { id: string; value: string | null; className?: string }) {
  return (
    <Button id={id} className={className} onClick={() => api.backup.setLocation(value)}>
      {value ?? 'Choose a folder'}
    </Button>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-6 py-3.5">
      <dt className="label-mono">{label}</dt>
      <dd className="mt-1 text-sm leading-5 text-ink">{children}</dd>
    </div>
  )
}
