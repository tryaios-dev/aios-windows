import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { Settings, UpdateNotice } from '@/lib/types'
import { relativeTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/fields'
import { Callout } from '@/components/ui/feedback'
import { Ledger, SettingGroup, SettingPanel, SettingRow } from './SettingRow'
import { Advanced, DrawnCheck, Reveal } from './shared'

/** General: what happened to the last update, an update that is ready, this version with "Check now", and the two daily checks. */
export function GeneralSection() {
  const settings = useStore((s) => s.settings)
  const notice = useStore((s) => s.updateNotice)
  return (
    <>
      {(notice || settings.update_available) && (
        <div className="flex flex-col gap-3">
          {notice && <UpdateOutcome notice={notice} />}
          {settings.update_available && <UpdateReady version={settings.update_available.version} />}
        </div>
      )}
      <VersionPlate settings={settings} />
      <SettingGroup title="Automatic checks" description="AIOS goes online only to check for updates and to download an AI model you install.">
        <SettingPanel>
          <SettingRow
            htmlFor="settings-update-check"
            label="Check for updates"
            hint="When AIOS starts, and at most once a day. Turn off for computers that never go online."
            control={<Switch id="settings-update-check" checked={settings.update_check} onCheckedChange={(v) => api.settings.update({ update_check: v })} />}
          />
          <SettingRow
            htmlFor="settings-catalogue-check"
            label="Check for new AI models"
            hint="When AIOS starts, and at most once a day. Only the list is checked. An AI model is downloaded, directly from its publisher, when you install it."
            control={<Switch id="settings-catalogue-check" checked={settings.catalogue_check} onCheckedChange={(v) => api.settings.update({ catalogue_check: v })} />}
          />
        </SettingPanel>
      </SettingGroup>
      <Advanced summary="Other version numbers">
        <SettingGroup title="Versions">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'Model catalogue', v: settings.catalogue_version, mono: true, hint: 'Model Catalogue v1, signed' },
                { k: 'Database schema', v: settings.schema_version, mono: true, hint: 'Migrations run at start, after a backup of the database' },
              ]}
            />
          </SettingPanel>
        </SettingGroup>
      </Advanced>
    </>
  )
}

/* ---------------- After an update ---------------- */

function UpdateOutcome({ notice }: { notice: UpdateNotice }) {
  const dismiss = (
    <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => api.settings.dismissUpdateNotice()}>
      Dismiss
    </Button>
  )
  if (notice.kind === 'installed') return <Callout tone="success" title={`AIOS is now version ${notice.version}.`} action={dismiss} />
  return (
    <Callout tone="deny" title="The update did not complete." action={dismiss}>
      Your data was put back as it was. AIOS will try again next time it starts.
    </Callout>
  )
}

/* ---------------- Update ready ---------------- */

function UpdateReady({ version }: { version: string }) {
  return (
    <Callout
      tone="info"
      title={`AIOS ${version} is ready`}
      action={
        <Button variant="primary" size="sm" onClick={() => api.settings.installUpdate()}>
          Install when I close AIOS
        </Button>
      }
    >
      It installs when you close AIOS. Your data is backed up first and put back if anything goes wrong.
    </Callout>
  )
}

/* ---------------- This version ---------------- */

function VersionPlate({ settings }: { settings: Settings }) {
  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState<'idle' | 'current' | 'failed'>('idle')

  const checkNow = async () => {
    setChecking(true)
    setOutcome('idle')
    try {
      await api.settings.checkForUpdates()
      // When an update is ready the notice at the top of the section says so.
      setOutcome(useStore.getState().settings.update_available ? 'idle' : 'current')
    } catch {
      setOutcome('failed')
    } finally {
      setChecking(false)
    }
  }

  return (
    <section aria-labelledby="general-version" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5 p-6">
        <div className="flex min-w-[min(100%,16rem)] flex-1 items-start gap-4">
          <ArtTile src={ART.update} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="label-mono">This version</div>
            <h3 id="general-version" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink tabular">
              AIOS {settings.app_version}
            </h3>
            <p className="mt-1 text-sm leading-5 text-ink-soft" aria-live="polite">
              {outcome === 'current' ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-green">
                  <DrawnCheck />
                  AIOS is up to date.
                </span>
              ) : (
                <span className="tabular">Pilot version. {settings.last_update_check ? `Last checked for updates ${relativeTime(settings.last_update_check)}.` : 'Not checked for updates yet.'}</span>
              )}
            </p>
          </div>
        </div>
        <Button className="shrink-0" leading={<RefreshCw className="size-3.5" />} loading={checking} onClick={checkNow}>
          {checking ? 'Checking…' : 'Check now'}
        </Button>
      </div>
      <div aria-live="polite">
        <Reveal open={outcome === 'failed'}>
          <div className="border-t border-line-soft px-6 py-4">
            <Callout tone="deny" compact title="AIOS could not check">
              Make sure this computer is online, then try again. Nothing else is affected.
            </Callout>
          </div>
        </Reveal>
      </div>
      <p className="border-t border-line-soft bg-paper-raised px-6 py-2.5 text-xs leading-4.5 text-ink-soft">Check now looks once for a new version of AIOS and for new AI models, even when both switches below are off.</p>
    </section>
  )
}
