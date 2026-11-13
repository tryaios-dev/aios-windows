import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, DatabaseBackup, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/lib/store'
import { ConfirmDialog } from '@/components/ui/overlays'
import { KeyValue, Mono } from '@/components/ui/layout'
import { Disclosure, IconTile, Plate, SetupFrame, StepBody, StepHeading } from './SetupFrame'
import { platform } from '@/lib/platform'

/** The AIOS data folder as the design shows it: without the trailing separator. */
const DATA_FOLDER = platform.folders.root.slice(0, -platform.sep.length)

/**
 * Shown full-screen at start-up when Windows no longer holds the keys for
 * this account (a Windows reset or a rebuilt profile). The data is still on
 * disk and still encrypted; this is the moment the recovery key exists for.
 * The screen changes nothing itself: it leads into Restore or into setup.
 */
export function CannotOpenScreen() {
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <SetupFrame eyebrow="Start-up">
      <StepBody>
        <StepHeading
          title="AIOS cannot open your data."
          lede={`Your conversations are encrypted, and the key ${platform.os} kept for your account is no longer there. This happens after ${platform.os} is reset or your account is rebuilt. Your data has not been deleted.`}
        />

        <div className="flex flex-col gap-4">
          <Plate as="section" aria-labelledby="cannot-open-restore" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <IconTile tone="green" className="mt-0.5">
                <DatabaseBackup strokeWidth={1.75} />
              </IconTile>
              <div className="min-w-0">
                <h2 id="cannot-open-restore" className="text-lg font-semibold leading-6 text-ink">
                  Restore from a backup
                </h2>
                <p className="mt-1 text-sm leading-5 text-ink-soft">You need your backup and your recovery key. Your projects and conversations come back as they were when the backup was made.</p>
              </div>
            </div>
            <Button variant="primary" size="lg" className="shrink-0 self-start sm:self-center" trailing={<ArrowRight className="size-3.5" />} onClick={() => navigate('/setup/restore')}>
              Restore from a backup
            </Button>
          </Plate>

          <Plate as="section" tone="paper" aria-labelledby="cannot-open-fresh" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <IconTile className="mt-0.5 bg-white">
                <RotateCcw strokeWidth={1.75} />
              </IconTile>
              <div className="min-w-0">
                <h2 id="cannot-open-fresh" className="text-lg font-semibold leading-6 text-ink">
                  Start fresh
                </h2>
                <p className="mt-1 text-sm leading-5 text-ink-soft">Set AIOS up again with nothing in it. Choose this only if you have no backup.</p>
              </div>
            </div>
            <Button size="lg" className="shrink-0 self-start sm:self-center" onClick={() => setConfirmOpen(true)}>
              Start fresh
            </Button>
          </Plate>

          <Disclosure label="Details" className="mt-2">
            <KeyValue
              dense
              rows={[
                { k: 'What happened', v: `AIOS asked ${platform.keyStore} for its keys at start-up and ${platform.os} returned no entry for this account.` },
                { k: 'Keys affected', v: `The database key and the signing key for the activity record. ${platform.os} protects both for one ${platform.account} on one computer.` },
                { k: 'Your data', v: <>The encrypted database (<Mono className="text-ink">chats.db</Mono>) is still in <Mono className="break-all text-ink">{DATA_FOLDER}</Mono>. Without the database key it cannot be read.</> },
                { k: 'Why a backup works', v: `A backup carries the same keys, wrapped with your recovery key. Restoring unwraps them and stores them with ${platform.os} again.` },
              ]}
            />
          </Disclosure>
        </div>
      </StepBody>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Start fresh?"
        description="The conversations on this computer can no longer be opened. If you have a backup and your recovery key, restore from it instead."
        confirmLabel="Start fresh"
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmOpen(false)
          // An empty installation with new keys; the old data stays unreadable on disk.
          const store = useStore.getState()
          store.setSim({ keysMissing: false })
          store.resetFirstRun('fresh')
          navigate('/setup')
        }}
      />
    </SetupFrame>
  )
}
