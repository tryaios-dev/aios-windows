import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { FileText } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import type { Health } from '@/lib/types'
import { modelLabel } from '@/lib/words'
import { useEngineStatus, useWriterStatus } from '@/app/useEngineStatus'
import type { DotTone } from '@/components/ui/chips'
import { Button } from '@/components/ui/button'
import { Ledger, PanelNote, PathValue, SettingGroup, SettingPanel, SettingRow } from './SettingRow'
import { Advanced, DrawnCheck, StatusRow } from './shared'
import { platform } from '@/lib/platform'

const LOG_FOLDER = platform.folders.logs

const APP: Record<Health['backend'], { tone: DotTone; pulse?: boolean; status: string; detail?: string }> = {
  ok: { tone: 'green', status: 'Running' },
  starting: { tone: 'brass', pulse: true, status: 'Starting', detail: 'Give it a few seconds.' },
  down: { tone: 'deny', status: 'Not running', detail: 'Close AIOS and open it again. If that does not help, create a diagnostic file below.' },
}

const settingsLink = 'font-medium text-green hover:underline'

/** Troubleshooting: is everything running, and a diagnostic file for support. */
export function TroubleshootingSection() {
  const health = useStore((s) => s.health)
  const companyFlag = useStore((s) => s.health.company.enabled)
  const hasModel = useStore((s) => s.installedModels.length > 0)
  const model = useStore((s) => s.installedModels.find((m) => m.id === (s.health.loaded_model_id ?? s.settings.default_model_id)))
  const engine = useEngineStatus()
  const writer = useWriterStatus()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)

  const app = APP[health.backend]
  const paused = health.writer === 'unavailable'

  // The shared hooks give the dot; the words here are the glossary's.
  let ai: { status: string; detail?: ReactNode }
  if (!hasModel || health.engine === 'no_model') {
    ai = {
      status: 'Not installed',
      detail: (
        <>
          Chat needs an AI model. Everything else works without it.{' '}
          <Link to="/models" className={settingsLink}>
            Open AI models
          </Link>
        </>
      ),
    }
  } else if (health.engine === 'ready' || health.engine === 'generating') {
    ai = { status: 'Ready', detail: health.engine === 'generating' ? `${modelLabel(model)} is writing an answer.` : modelLabel(model) }
  } else if (health.engine === 'loading') {
    ai = { status: 'Starting', detail: 'The first answer after a rest takes a little longer.' }
  } else if (health.engine === 'failed') {
    // A fault has no glossary word of its own, so this row says what the sidebar says.
    ai = {
      status: engine.label,
      detail: (
        <>
          {engine.detail}. If it keeps happening, turn on Compatibility mode in{' '}
          <Link to="/settings/computer" className={settingsLink}>
            This computer
          </Link>
          .
        </>
      ),
    }
  } else {
    ai = { status: 'Resting. Starts when you send a message.' }
  }

  // One answer first; the rows below say which part it is about.
  let overall: { art: string; headline: string; line: string }
  if (health.backend === 'down') {
    overall = { art: ART.warning, headline: 'AIOS is not running', line: 'The list below shows which part has stopped, and what to try.' }
  } else if (health.backend === 'starting') {
    overall = { art: ART.update, headline: 'AIOS is starting', line: 'Give it a few seconds.' }
  } else if (health.engine === 'failed' || paused) {
    overall = { art: ART.warning, headline: 'Something needs a look', line: 'You can keep working. The list below says what has happened and what to do.' }
  } else if (!hasModel || health.engine === 'no_model') {
    overall = { art: ART.troubleshooting, headline: 'Running, with no AI model', line: 'Chat needs an AI model. Everything else works without it.' }
  } else {
    overall = { art: ART.done, headline: 'Everything is running', line: 'This list keeps itself up to date while the page is open.' }
  }

  const createFile = async () => {
    setCreating(true)
    setCreated(false)
    // POST /system/support-bundle: the desktop app asks where to save, then zips the log folder there
    // (logs only). Gathering the logs takes a moment; the toast says where the file went.
    const out = await api.system.supportBundle()
    setCreating(false)
    if (!out.ok) {
      if (!out.cancelled) useStore.getState().toast({ kind: 'deny', title: 'Diagnostic file not saved', description: out.error })
      return
    }
    setCreated(true)
    useStore.getState().toast({ kind: 'success', title: 'Diagnostic file saved', description: out.path })
  }

  return (
    <>
      <section aria-labelledby="troubleshooting-status" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="flex items-start gap-4 p-6">
          <ArtTile src={overall.art} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="label-mono">Is everything running?</div>
            <h3 id="troubleshooting-status" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
              {overall.headline}
            </h3>
            <p className="mt-1 max-w-md text-sm leading-5 text-ink-soft">{overall.line}</p>
          </div>
        </div>
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          <StatusRow tone={app.tone} pulse={app.pulse} name="AIOS" status={app.status} detail={app.detail} />
          <StatusRow tone={engine.tone} pulse={engine.pulse} name="AI model" status={ai.status} detail={ai.detail} />
          <StatusRow
            tone={writer.tone}
            name="Activity recording"
            status={
              paused ? (
                <>
                  Paused. It will catch up by itself.{health.evidence_pending > 0 && <span className="tabular"> ({health.evidence_pending} waiting)</span>}
                </>
              ) : (
                'Recording'
              )
            }
            detail={paused ? 'Chat keeps working. Answers written while it is paused show “Not recorded yet” until it catches up.' : undefined}
          />
          {companyFlag && (
            <StatusRow
              tone={health.company.reachable ? 'green' : 'deny'}
              name="Company server"
              status={health.company.reachable ? 'Reachable' : 'Not reachable'}
              detail={health.company.reachable ? undefined : 'Conversations on this computer are not affected.'}
            />
          )}
        </ul>
      </section>

      <SettingGroup title="Diagnostic file for support" description="If something is wrong and support asks for more detail, this is what to send them.">
        <SettingPanel>
          <SettingRow
            align="start"
            label="Create a diagnostic file"
            hint="It contains technical logs about how AIOS is running, and never your conversations. It stays on this computer unless you send it."
            control={
              <Button leading={<FileText className="size-3.5" />} loading={creating} onClick={createFile}>
                {creating ? 'Creating…' : 'Create diagnostic file'}
              </Button>
            }
          />
          <div aria-live="polite" className="empty:hidden">
            {created && !creating && (
              <PanelNote tone="green" icon={<DrawnCheck className="size-3.5" />}>
                Saved to your Documents folder.
              </PanelNote>
            )}
          </div>
        </SettingPanel>
      </SettingGroup>

      <Advanced summary="Technical names and logs">
        <SettingGroup title="Components">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'Backend', v: health.backend, mono: true, hint: 'Local API. Loopback only; it never listens on the network.' },
                { k: 'Local engine', v: `${health.engine} · ${health.engine_build === 'cpu' ? 'CPU build' : 'GPU build (Vulkan)'}`, mono: true, hint: 'llama-server' },
                { k: 'Evidence writer', v: health.writer, mono: true, hint: paused ? `${health.evidence_pending} events waiting in the outbox. Each is appended exactly once when the writer is back.` : 'Every request is appended to the chain.' },
                ...(companyFlag ? [{ k: 'Company provider', v: health.company.reachable ? 'reachable' : 'unreachable', mono: true, hint: health.company.base_url }] : []),
              ]}
            />
          </SettingPanel>
        </SettingGroup>
        <SettingGroup title="Logs">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'Log folder', v: <PathValue value={LOG_FOLDER} /> },
                { k: 'Retention', v: '14 days or 20 MB, whichever comes first' },
                { k: 'Contents', v: 'Operations, errors and timings. Never message content, prompts or keys.' },
                { k: 'Diagnostic file', v: 'A zip of the log folder and nothing more.' },
              ]}
            />
          </SettingPanel>
        </SettingGroup>
      </Advanced>
    </>
  )
}
