import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Gauge } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { selectModelName, selectRecommendedTier, useStore } from '@/lib/store'
import { formatDateTime, relativeTime } from '@/lib/format'
import { modelLabel, sizeBlurb, sizeWord, speedWords, waitWords } from '@/lib/words'
import { MINIMUM_PROFILE } from '@/data/catalogue'
import { FallbackNotice } from '@/components/app/FallbackNotice'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/fields'
import { Callout, Progress } from '@/components/ui/feedback'
import { Ledger, PanelNote, SettingGroup, SettingPanel, SettingRow } from './SettingRow'
import { Advanced, DrawnCheck, Reveal } from './shared'
import { platform } from '@/lib/platform'

const ENGINE_STATE: Record<string, string> = {
  not_started: 'Not started',
  no_model: 'No model installed',
  loading: 'Loading the model',
  ready: 'Ready, model in memory',
  generating: 'Generating',
  idle_unloaded: 'Idle, model unloaded',
  failed: 'Stopped, restarting',
}

/** This computer: how fast answers arrive here, what the computer has, and Compatibility mode. */
export function ComputerSection() {
  const hardware = useStore((s) => s.hardware)
  const health = useStore((s) => s.health)
  const safeMode = useStore((s) => s.settings.safe_mode_cpu)
  const tier = useStore(selectRecommendedTier)
  const hasModel = useStore((s) => s.installedModels.length > 0)
  const inUse = useStore((s) => s.installedModels.find((m) => m.id === s.settings.default_model_id))
  const generating = useStore((s) => !!s.generation)
  const benchModel = useStore(selectModelName(hardware.benchmark?.model_id))
  const loadedName = useStore(selectModelName(health.loaded_model_id))
  const navigate = useNavigate()
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [justTested, setJustTested] = useState(false)

  const gpu = hardware.gpu
  const benchmark = hardware.benchmark
  const speed = speedWords(benchmark)
  const wait = waitWords(benchmark)
  const onGraphics = health.engine_build === 'vulkan'
  const inMemory = health.engine === 'ready' || health.engine === 'generating' || health.engine === 'loading'

  const runTest = async () => {
    setRunning(true)
    setFailed(false)
    setJustTested(false)
    try {
      await api.system.benchmark()
      setJustTested(true)
    } catch {
      setFailed(true)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <FallbackNotice />

      {tier === null && (
        <Callout tone="caution" title="This computer cannot run an AI model">
          AIOS needs at least {MINIMUM_PROFILE.ram_gb} GB of memory and {MINIMUM_PROFILE.free_disk_gb} GB of free space. Everything except chat still works.
        </Callout>
      )}

      {/* ---------------- Speed ---------------- */}
      <section aria-labelledby="computer-speed" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-5 p-6">
          <div className="flex min-w-[min(100%,18rem)] flex-1 items-start gap-4">
            <ArtTile src={ART.speed} size="xl" dimmed={!benchmark} />
            <div className="min-w-0 flex-1">
              <div className="label-mono">Speed on this computer</div>
              <h3 id="computer-speed" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
                <span key={benchmark?.run_at ?? 'none'} className="inline-block animate-fade">
                  {speed.headline}
                </span>
              </h3>
              <p className="mt-1 max-w-md text-sm leading-5 text-ink-soft">
                {speed.line}
                {wait && ` ${wait}`}
              </p>
            </div>
          </div>
          <Button className="shrink-0" variant={benchmark ? 'secondary' : 'primary'} leading={<Gauge className="size-3.5" />} loading={running} disabled={!hasModel || generating} onClick={runTest}>
            {running ? 'Testing…' : benchmark ? 'Test again' : 'Run a speed test'}
          </Button>
        </div>
        <div aria-live="polite">
          <Reveal open={running || failed}>
            <div className="border-t border-line-soft px-6 py-4">
              {running ? (
                <>
                  <Progress indeterminate value={0} label="Speed test running" />
                  <p className="mt-2.5 text-xs leading-4.5 text-ink-50">Writing a short test answer and timing it. It takes a few seconds. Nothing leaves this computer.</p>
                </>
              ) : failed ? (
                <Callout
                  tone="deny"
                  compact
                  title="The speed test did not finish"
                  action={
                    <Button size="sm" onClick={runTest}>
                      Try again
                    </Button>
                  }
                >
                  If it keeps stopping, turn on Compatibility mode below.
                </Callout>
              ) : null}
            </div>
          </Reveal>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line-soft bg-paper-raised px-6 py-2.5 text-xs leading-4.5 text-ink-soft">
          <span>{onGraphics ? 'AIOS is using your graphics card.' : 'AIOS is using your processor.'}</span>
          {!hasModel ? (
            <span className="text-ink-50">Install an AI model to run the test.</span>
          ) : generating ? (
            <span className="text-ink-50">Wait for the current answer to finish, then run the test.</span>
          ) : benchmark ? (
            <span className="inline-flex items-center gap-1.5 tabular text-ink-50" title={formatDateTime(benchmark.run_at)}>
              {justTested && !running && <DrawnCheck className="size-3.5 text-green" />}
              Tested {relativeTime(benchmark.run_at)}
            </span>
          ) : null}
        </div>
      </section>

      {/* ---------------- What it has ---------------- */}
      <SettingGroup title="What this computer has" description="AIOS reads this when it starts, to suggest an AI model that fits. It is not sent anywhere.">
        <SettingPanel>
          <Ledger
            rows={[
              { k: 'Processor', v: hardware.cpu },
              { k: 'Memory', v: `${hardware.ram_gb} GB`, mono: true },
              {
                k: 'Graphics card',
                v: gpu ? gpu.name : <span className="text-ink-soft">None that AIOS can use</span>,
                hint: gpu && !gpu.driver_ok ? <span className="text-brass-text">Its driver is not responding, so AIOS is using your processor. Updating the driver in {platform.os} usually fixes this.</span> : undefined,
              },
              { k: 'Free space', v: `${hardware.free_disk_gb} GB`, mono: true },
              { k: platform.os, v: hardware.os },
            ]}
          />
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- Compatibility mode ---------------- */}
      <SettingGroup title="Compatibility mode" description="AIOS normally uses your graphics card, which is faster. Compatibility mode uses your processor instead.">
        <SettingPanel>
          <SettingRow
            htmlFor="settings-compatibility-mode"
            label="Compatibility mode"
            hint="Use this if answers stop or crash. Slower, more reliable."
            control={<Switch id="settings-compatibility-mode" checked={safeMode} onCheckedChange={(v) => api.settings.update({ safe_mode_cpu: v })} />}
          />
          {!gpu && <PanelNote>This computer has no graphics card AIOS can use, so it already runs this way.</PanelNote>}
          {gpu && safeMode && <PanelNote>On. AIOS uses your processor and leaves the graphics card alone, starting with the next answer.</PanelNote>}
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- AI model in use ---------------- */}
      <SettingGroup title="AI model in use">
        <SettingPanel>
          <SettingRow
            label={inUse ? modelLabel(inUse) : 'No AI model installed'}
            hint={inUse ? sizeBlurb(inUse.tier) : 'Chat needs one. Everything else works without it.'}
            control={
              <Button trailing={<ArrowRight className="size-3.5" />} onClick={() => navigate('/models')}>
                {inUse ? 'Change in AI models' : 'Open AI models'}
              </Button>
            }
          />
        </SettingPanel>
      </SettingGroup>

      {/* ---------------- Advanced ---------------- */}
      <Advanced summary="Speed figures and technical details">
        <SettingGroup title="Benchmark">
          <SettingPanel>
            {benchmark ? (
              <Ledger
                rows={[
                  { k: 'Tokens per second', v: benchmark.tokens_per_second.toFixed(1), mono: true },
                  { k: 'Time to first token', v: `${Math.round(benchmark.time_to_first_token_ms)} ms`, mono: true },
                  { k: 'Engine build', v: benchmark.engine === 'cpu' ? 'CPU' : 'GPU (Vulkan)', mono: true },
                  { k: 'Model', v: benchModel },
                  { k: 'Run at', v: formatDateTime(benchmark.run_at), mono: true },
                ]}
              />
            ) : (
              <PanelNote>No benchmark has been run on this machine.</PanelNote>
            )}
          </SettingPanel>
        </SettingGroup>
        <SettingGroup title="Engine">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'Build', v: onGraphics ? 'GPU (Vulkan)' : 'CPU', mono: true, hint: safeMode ? 'Safe mode (CPU) is on' : undefined },
                { k: 'State', v: ENGINE_STATE[health.engine] ?? health.engine },
                { k: 'Loaded model', v: inMemory && health.loaded_model_id ? loadedName : <span className="text-ink-50">None loaded</span> },
                { k: 'Idle behaviour', v: 'Starts when a conversation needs it. Unloads the model after five minutes idle to free memory.' },
              ]}
            />
          </SettingPanel>
        </SettingGroup>
        <SettingGroup title="Hardware profile">
          <SettingPanel>
            <Ledger
              rows={[
                { k: 'CPU cores', v: hardware.cores, mono: true },
                { k: 'VRAM', v: gpu ? `${gpu.vram_gb} GB` : 'None', mono: true, hint: gpu ? (gpu.driver_ok ? 'Driver OK' : 'Driver not responding') : undefined },
                { k: 'Recommended tier', v: tier ? `${tier === 'small' ? 'Small' : 'Medium'} (${sizeWord(tier)})` : 'Below minimum' },
              ]}
            />
          </SettingPanel>
        </SettingGroup>
      </Advanced>
    </>
  )
}
