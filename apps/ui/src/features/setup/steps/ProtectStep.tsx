import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Check, Copy, Printer } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/fields'
import { Callout } from '@/components/ui/feedback'
import { SectionLabel, useCopy } from '@/components/ui/layout'
import { Disclosure, DrawnCheck, Plate, StepBody, StepFooter, StepHeading } from '../SetupFrame'
import { platform } from '@/lib/platform'

const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1]

/** The three sentences from docs/GLOSSARY.md, verbatim and in this order. */
const STATEMENTS = [
  { icon: ART.recoveryKey, text: 'If this computer is lost or stops working, this key opens your backup on another one.' },
  { icon: ART.vault, text: 'The key is not a backup. It opens one. You need both.' },
  { icon: ART.warning, text: 'AIOS does not keep this key. Keep it somewhere other than this computer.' },
]

/** Stand-ins for the Windows save dialog. */
const SAVE_PLACES = [
  { value: 'E:\\', label: 'E:\\ (USB drive)', sameDisk: false },
  { value: 'C:\\Users\\pilot\\Documents', label: 'C:\\Users\\pilot\\Documents', sameDisk: true },
]

/** Stand-ins for the Windows folder dialog. */
const LATER = 'later'
const BACKUP_PLACES = [
  { value: 'E:\\AIOS backups', label: 'E:\\AIOS backups (USB drive)' },
  { value: '\\\\office-nas\\backups\\AIOS', label: '\\\\office-nas\\backups\\AIOS' },
  { value: LATER, label: 'Set up later' },
]

const KEY_FILE = 'AIOS recovery key.txt'

export interface ProtectDraft {
  /** What has been typed into "the last four characters". */
  typed: string
  /** Where the key file was saved, if it was. */
  savedTo?: string
  /** The backup place chosen on this screen, or "later". */
  backupChoice?: string
}

const clean = (s: string) => s.replace(/[\s-]/g, '').toUpperCase()

/** True when what was typed is the last four characters of the key. Case and spaces do not matter. */
function lastFourMatches(typed: string, key: string | null): boolean {
  return !!key && clean(typed) === clean(key).slice(-4)
}

/**
 * Step 4. The one required decision in setup: saving the recovery key. The
 * key is issued once per visit to the wizard; if AIOS was closed while an
 * unconfirmed key was on screen, a new one is issued and the screen says so
 * (decision D13).
 */
export function ProtectStep({ note, reissue, onIssued, confirmed, newKeyNotice, draft, onDraft, onBack, onContinue }: { note?: string; /** Issue a new key even if one is already held. */ reissue: boolean; onIssued: (isNew: boolean) => void; /** The key on screen was already confirmed earlier in this visit. */ confirmed: boolean; newKeyNotice: boolean; draft: ProtectDraft; onDraft: (patch: Partial<ProtectDraft>) => void; onBack: () => void; onContinue: () => void }) {
  const key = useStore((s) => s.recoveryKey)
  const storedPlace = useStore((s) => s.settings.backup_location)
  const hasBackup = useStore((s) => !!s.settings.last_backup_at)
  const issued = useRef(false)
  const { copied, copy } = useCopy()

  useEffect(() => {
    if (issued.current) return
    issued.current = true
    const isNew = reissue || !useStore.getState().recoveryKey
    if (isNew) api.firstRun.issueRecoveryKey()
    // Until the person confirms it, a key on screen counts as not saved (decision D13).
    if (isNew || !confirmed) api.firstRun.setProgress({ step: 3, keyShownUnconfirmed: true })
    onIssued(isNew)
    // The ref keeps this to one key per visit, whatever changes afterwards.
  }, [reissue, confirmed, onIssued])

  const groups = key ? key.split('-') : []
  const typedClean = clean(draft.typed)
  const matches = lastFourMatches(draft.typed, key)
  const wrong = !matches && typedClean.length >= 4
  const savePlace = SAVE_PLACES.find((p) => p.value === draft.savedTo)
  // A place already chosen (for example when setup is replayed) is shown as chosen.
  const backupChoice = draft.backupChoice ?? (BACKUP_PLACES.some((p) => p.value === storedPlace) ? (storedPlace ?? undefined) : undefined)

  const print = () => useStore.getState().toast({ kind: 'info', title: 'Sent to your printer' })

  const chooseBackup = (value: string) => {
    onDraft({ backupChoice: value })
    api.backup.setLocation(value === LATER ? null : value)
  }

  return (
    <>
      <StepBody>
        <StepHeading note={note} title="Save your recovery key" lede="Everything AIOS keeps on this computer is encrypted. Save this key now. It is shown once." />

        <div className="flex flex-col gap-8">
          {newKeyNotice && (
            <Callout tone="caution" title="This is a new key.">
              A key you noted before you closed AIOS no longer works.
            </Callout>
          )}

          <ul className="flex flex-col gap-4">
            {STATEMENTS.map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-4">
                <ArtTile src={icon} size="lg" />
                <p className="min-w-0 pt-2.5 text-md leading-6 text-ink">{text}</p>
              </li>
            ))}
          </ul>

          {key && (
            <motion.div className="flex flex-col gap-8" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE }}>
              <section aria-label="Your recovery key">
                <Plate className="p-1.5 shadow-plate sm:p-1.5">
                  <div className="rounded-[7px] border border-line-soft px-5 pb-5 pt-4 sm:px-6">
                    <SectionLabel right="Shown once">Recovery key</SectionLabel>
                    <div className="mt-5 grid grid-cols-2 gap-y-3 sm:grid-cols-4" aria-label={`Recovery key ${key}`} role="group">
                      {groups.map((group, i) => (
                        <span key={i} className={cn('flex items-center justify-center font-mono text-2xl leading-8 tracking-[0.1em] tabular text-ink', i % 2 === 0 && 'border-r border-line-soft', i % 4 !== 3 && 'sm:border-r sm:border-line-soft', i % 4 === 3 && 'sm:border-r-0')}>
                          {group}
                        </span>
                      ))}
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
                      <Button leading={copied ? <Check className="size-3.5 text-green" /> : <Copy className="size-3.5" />} onClick={() => copy(key)} aria-label={copied ? 'Copied recovery key' : 'Copy recovery key'}>
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                      <Button leading={<Printer className="size-3.5" />} onClick={print}>
                        Print
                      </Button>
                      <Select
                        aria-label="Save as a file"
                        value={draft.savedTo}
                        onValueChange={(v) => onDraft({ savedTo: v })}
                        placeholder="Save as a file"
                        className="h-8.5 w-auto min-w-[168px] flex-1 border-line bg-paper-raised text-sm font-medium data-[placeholder]:text-ink sm:flex-none"
                        options={SAVE_PLACES.map((p) => ({ value: p.value, label: <span className="font-mono text-sm">{p.label}</span>, description: p.sameDisk ? 'The same disk as your AIOS' : 'Kept apart from this computer' }))}
                      />
                      <span className="ml-auto hidden font-mono text-xs leading-4.5 tabular text-ink-50 sm:inline">8 groups of 4</span>
                    </div>
                  </div>
                </Plate>

                {savePlace && (
                  <div className="mt-3 flex flex-col gap-3" aria-live="polite">
                    <p className="flex items-start gap-2 px-1 text-sm leading-5 text-ink-soft">
                      <DrawnCheck className="mt-1 size-3 text-green" />
                      <span>
                        Saved as <span className="font-mono text-xs text-ink">{KEY_FILE}</span> in <span className="font-mono text-xs text-ink">{savePlace.value}</span>
                      </span>
                    </p>
                    {savePlace.sameDisk && (
                      <Callout tone="caution" compact>
                        That is the same disk as your AIOS. If this computer fails, the key is lost with it. Choose a USB drive or another place.
                      </Callout>
                    )}
                  </div>
                )}
                <p className="mt-3 px-1 text-sm leading-5 text-ink-soft">Good places for it: on paper, on a USB drive, or in a password manager.</p>
              </section>

              <section className="border-t border-line-soft pt-8">
                <Field label="To check you have saved it, type the last 4 characters of your key" htmlFor="key-last-four" hint="Read them from where you saved it, not from the screen above." error={wrong ? 'That does not match the last four characters.' : undefined}>
                  <div className="mt-1 flex items-center gap-3">
                    <Input
                      id="key-last-four"
                      mono
                      value={draft.typed}
                      onChange={(e) => onDraft({ typed: e.target.value.toUpperCase().slice(0, 12) })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && matches) onContinue()
                      }}
                      placeholder="XXXX"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      aria-invalid={wrong || undefined}
                      className="h-10 w-32 text-center text-md tracking-[0.14em]"
                    />
                    {matches && (
                      <span className="flex items-center gap-2 text-sm leading-5 text-green-dark animate-in" role="status">
                        <span className="flex size-[18px] items-center justify-center rounded-full bg-green text-white" aria-hidden>
                          <DrawnCheck className="size-2.5" strokeWidth={2.75} />
                        </span>
                        That matches.
                      </span>
                    )}
                  </div>
                </Field>
              </section>

              <section className="border-t border-line-soft pt-8" aria-labelledby="backup-place-title">
                <div className="flex items-start gap-4">
                  <ArtTile src={ART.backup} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h2 id="backup-place-title" className="text-lg font-semibold leading-6 text-ink">
                      Back up your AIOS
                    </h2>
                    <p className="mt-1 max-w-[56ch] text-sm leading-5 text-ink-soft">Choose a folder or drive for your encrypted backup. It stays where you put it. A USB drive or a shared folder is safest, because it is not this computer.</p>
                  </div>
                </div>
                <Select
                  aria-label="Where backups go"
                  value={backupChoice}
                  onValueChange={chooseBackup}
                  placeholder="Choose a folder"
                  className="mt-4 h-10"
                  options={BACKUP_PLACES.map((p) => ({ value: p.value, label: p.value === LATER ? p.label : <span className="font-mono text-sm">{p.label}</span> }))}
                />
                <p className="mt-3 px-1 text-sm leading-5 text-ink-soft" aria-live="polite">
                  {backupChoice === LATER
                    ? 'If you skip this, your AIOS data stays only on this computer. You can turn on backup at any time in Settings › Backup and recovery.'
                    : backupChoice
                      ? hasBackup
                        ? 'Backups will go here, and stay there.'
                        : 'Backups will go here, and stay there. No backup exists yet: make the first one from Settings › Backup and recovery once AIOS is open.'
                      : 'If you skip this, your AIOS data stays only on this computer. You can turn on backup at any time in Settings › Backup and recovery.'}
                </p>
              </section>

              <Disclosure label="What AIOS cannot protect you from">
                <ul className="flex flex-col gap-2.5 text-sm leading-5 text-ink-soft">
                  <li>A program you run yourself can read what you can read. AIOS cannot stop it.</li>
                  <li>A stolen computer is safe only if {platform.os} is locked and disk encryption is on. Turn on {platform.diskEncryption} in {platform.diskEncryptionSettings}.</li>
                  <li>The activity record shows when something has been changed. It cannot stop the change.</li>
                </ul>
              </Disclosure>
            </motion.div>
          )}
        </div>
      </StepBody>
      <StepFooter onBack={onBack} primary={{ label: 'Continue', onClick: onContinue, disabled: !matches }} />
    </>
  )
}
