import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Check, Copy, Printer } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { notInThisBuild } from '@/bridge/live'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/fields'
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
  const issued = useRef(false)
  const { copied, copy } = useCopy()

  useEffect(() => {
    if (issued.current) return
    issued.current = true
    const isNew = reissue || !useStore.getState().recoveryKey
    if (isNew)
      void api.firstRun.issueRecoveryKey().then((r) => {
        // Desktop app: the backend shows the key exactly once; a second request is refused.
        if (!r.ok) useStore.getState().toast({ kind: 'deny', title: 'No new recovery key', description: r.error })
      })
    // Until the person confirms it, a key on screen counts as not saved (decision D13).
    if (isNew || !confirmed) api.firstRun.setProgress({ step: 3, keyShownUnconfirmed: true })
    onIssued(isNew)
    // The ref keeps this to one key per visit, whatever changes afterwards.
  }, [reissue, confirmed, onIssued])

  const groups = key ? key.split('-') : []
  const typedClean = clean(draft.typed)
  const matches = lastFourMatches(draft.typed, key)
  const wrong = !matches && typedClean.length >= 4
  // Printing and saving the key as a file are not in this build yet; Copy works.
  const print = () => notInThisBuild('Printing the key')

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
                      <span className="ml-auto hidden font-mono text-xs leading-4.5 tabular text-ink-50 sm:inline">{groups.length} groups of 4</span>
                    </div>
                  </div>
                </Plate>

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
                <p className="mt-4 px-1 text-sm leading-5 text-ink-soft">Backup comes in a later version of AIOS. Until then, your AIOS data stays only on this computer. Keep your recovery key safe all the same.</p>
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
