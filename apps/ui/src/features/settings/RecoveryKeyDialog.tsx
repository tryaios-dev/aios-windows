import { useId, useState } from 'react'
import { Copy } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Hint, Input, Label } from '@/components/ui/fields'
import { useCopy } from '@/components/ui/layout'
import { Dialog } from '@/components/ui/overlays'
import { DrawnCheck } from './shared'

const POINTS = [
  'The new key replaces the one you have now for every backup you make from here on.',
  'Backups you already have still need the old key. Keep it until you have a new backup.',
  'AIOS will ask you to back up straight afterwards, so there is a backup the new key opens.',
]

/** The last group of the key, which is what the person types to show they have it. */
function lastFour(key: string) {
  return key.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase()
}

/**
 * Create a new recovery key while AIOS still works (decision D4).
 * Explain, then show the key once, then ask for its last four characters.
 * Once the key is on screen the dialog stays open until that check passes:
 * closing early would leave a key nobody has.
 *
 * Mount it with a fresh `key` each time it opens so it always starts at the explanation.
 */
export function RecoveryKeyDialog({ open, onOpenChange, hasDestination, onBackUp }: { open: boolean; onOpenChange: (open: boolean) => void; hasDestination: boolean; /** Close and start a backup, or choose a destination first. */ onBackUp: () => void }) {
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const { copied, copy } = useCopy()
  const inputId = useId()

  const confirmed = !!recoveryKey && typed.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === lastFour(recoveryKey)
  const mismatch = !!recoveryKey && typed.length >= 4 && !confirmed
  const locked = !!recoveryKey && !confirmed

  if (!recoveryKey) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Create a new recovery key"
        description="Do this if you have lost your key, or think someone else has seen it."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={async () => setRecoveryKey(await api.recoveryKey.createNew())}>
              Create new key
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3.5">
            <ArtTile src={ART.recoveryKey} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-5 text-ink">If this computer is lost or stops working, this key opens your backup on another one.</p>
              <p className="mt-0.5 text-sm leading-5 text-ink-soft">The key is not a backup. It opens one. You need both.</p>
            </div>
          </div>
          <div>
            <div className="label-mono mb-2 px-0.5">What changes</div>
            <ol className="divide-y divide-line-soft rounded-lg border border-line bg-paper-raised">
              {POINTS.map((p, i) => (
                <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-x-2 px-3.5 py-2.5">
                  <span className="pt-0.5 font-mono text-xs leading-4.5 text-ink-50 tabular" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-sm leading-5 text-ink">{p}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Dialog>
    )
  }

  const groups = recoveryKey.split('-')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The key is shown once. Esc and outside clicks do nothing until it is confirmed.
        if (!next && locked) return
        onOpenChange(next)
      }}
      hideClose={locked}
      title="Your new recovery key"
      description="This is the only time AIOS shows it. Write it down, or save it somewhere other than this computer."
      footer={
        <>
          <Button variant="ghost" disabled={!confirmed} onClick={() => onOpenChange(false)}>
            Back up later
          </Button>
          <Button variant="primary" disabled={!confirmed} onClick={onBackUp}>
            {hasDestination ? 'Back up now' : 'Choose where backups go'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grain rounded-xl border border-line-strong bg-paper-deep p-1.5">
          <div className="rounded-lg border border-line bg-white px-4 pb-3 pt-5 shadow-card">
            <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-4" role="group" aria-label={`Recovery key ${recoveryKey}`}>
              {groups.map((group, i) => (
                <span
                  key={i}
                  className={cn(
                    'flex items-center justify-center font-mono text-lg leading-7 tracking-[0.1em] tabular text-ink',
                    i % 2 === 0 && 'border-r border-line-soft',
                    i % 4 !== 3 && 'sm:border-r sm:border-line-soft',
                    i % 4 === 3 && 'sm:border-r-0',
                  )}
                >
                  {group}
                </span>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-soft pt-3">
              <span className="label-mono">Shown once</span>
              {/* Fixed width, so the label changing to "Copied" does not move anything. */}
              <Button size="sm" className="w-24" leading={copied ? <DrawnCheck className="size-3.5 text-green" /> : <Copy className="size-3.5" />} onClick={() => copy(recoveryKey)} aria-label={copied ? 'Copied recovery key' : 'Copy recovery key'}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>Type the last four characters of the key</Label>
          <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
            <Input
              id={inputId}
              mono
              className="w-28 uppercase"
              value={typed}
              onChange={(e) => setTyped(e.target.value.slice(0, 4))}
              maxLength={4}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={mismatch || undefined}
              aria-describedby={`${inputId}-hint`}
            />
            <span aria-live="polite" className="text-sm leading-5">
              {confirmed && (
                <span className="inline-flex items-center gap-1.5 font-medium text-green">
                  <DrawnCheck className="size-4" /> That matches.
                </span>
              )}
              {mismatch && <span className="text-deny">That does not match. Check the last group of the key.</span>}
            </span>
          </div>
          <Hint>
            <span id={`${inputId}-hint`}>This shows you have the key somewhere you can read it back. The buttons below work once it matches.</span>
          </Hint>
        </div>

        <p className="rounded-lg border border-line bg-paper-raised px-3.5 py-2.5 text-sm leading-5 text-ink-soft">The old key no longer works for new backups. Back up now so you have a backup this key opens.</p>
      </div>
    </Dialog>
  )
}
