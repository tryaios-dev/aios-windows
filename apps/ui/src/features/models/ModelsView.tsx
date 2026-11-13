import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Cpu, Download } from 'lucide-react'
import { ART, modelLogo } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useExtras } from '@/lib/extras'
import { selectRecommendedTier, useStore } from '@/lib/store'
import type { CatalogueEntry, InstalledModel } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { modelLabel, sizeBlurb, speedWords } from '@/lib/words'
import { CATALOGUE, MINIMUM_PROFILE, catalogueEntry } from '@/data/catalogue'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/chips'
import { EmptyState } from '@/components/ui/feedback'
import { PageBody, PageHeader } from '@/components/ui/layout'
import { FallbackNotice } from '@/components/app/FallbackNotice'
import { ModelCard } from './ModelCard'
import { ModelUpdate } from './ModelUpdate'
import { listedInCatalogue, useModelUpdate } from './updateJourney'
import { FIT_TONE, fitFor, recommendedEntry, sizeExample } from './modelHelpers'

const quietLink = 'rounded-xs font-medium text-green underline-offset-4 hover:underline'

/**
 * AI models, route /models. One plate answers "which AI is answering me, and
 * how well does it run here"; the list under it is everything AIOS can install,
 * each with what it is good for, how it runs on this computer and one action.
 */
export function ModelsView() {
  const installed = useStore((s) => s.installedModels)
  const hardware = useStore((s) => s.hardware)
  const tier = useStore(selectRecommendedTier)
  const defaultId = useStore((s) => s.settings.default_model_id)
  const newModelOut = useStore((s) => s.sim.newModelOut)
  // Which entries are downloading, as a plain string: progress ticks belong to the cards, not to the page.
  const downloadingIds = useStore((s) => {
    let ids = ''
    for (const id in s.downloads) if (s.downloads[id].status !== 'done') ids += `${id},`
    return ids
  })
  const update = useModelUpdate()
  const updateRef = useRef<HTMLElement>(null)

  // Opening this page is what settles the green "New" tag in the menu.
  useEffect(() => {
    useExtras.getState().markModelsSeen()
  }, [newModelOut])

  const seeUpdate = () => {
    const el = updateRef.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
  }

  // Installed first, the one in use at the top. The order is fixed when the page
  // opens, so a card never jumps away from the pointer when an install finishes.
  const [entries] = useState(() => {
    const first = installed.length === 0 ? recommendedEntry(CATALOGUE, hardware, tier) : undefined
    const rank = (e: CatalogueEntry) => {
      const m = installed.find((x) => x.catalogue_entry_id === e.entry_id)
      if (m) return m.id === defaultId ? 0 : 1
      // A newer version sits straight after the one it replaces, so it appears there when an update finishes.
      const replaced = e.replaces ? installed.find((x) => x.catalogue_entry_id === e.replaces) : undefined
      if (replaced) return replaced.id === defaultId ? 0.5 : 1.5
      return e.entry_id === first?.entry_id ? 2 : 3
    }
    return [...CATALOGUE].sort((a, b) => rank(a) - rank(b))
  })

  // A newer version of an installed AI model is news at the top of the page, not one more entry in the list.
  // When none has been announced it is not offered at all.
  const downloading = downloadingIds.split(',')
  const listed = entries.filter((e) => listedInCatalogue(e, installed, newModelOut, downloading.includes(e.entry_id)))

  // With nothing installed, one entry is suggested. The plate at the top offers it as the page's one primary action.
  const suggested = installed.length === 0 ? recommendedEntry(listed, hardware, tier) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="AI models" description="The AI that answers you. It runs on this computer, and you can change it at any time." />
      <PageBody>
        <div className="flex flex-col gap-9">
          <FallbackNotice className="-mb-3" />
          {update && <ModelUpdate update={update} sectionRef={updateRef} />}
          {installed.length === 0 ? <FirstInstall suggested={suggested} cannotRun={tier === null} /> : <InUse installed={installed} />}

          <section aria-labelledby="models-available">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
              <h2 id="models-available" className="label-mono">
                {installed.length === 0 ? 'AI models you can install' : 'All AI models'}
              </h2>
              <Link to="/settings/computer" className={cn(quietLink, 'text-sm')}>
                See what this computer has
              </Link>
            </div>
            {listed.length === 0 ? (
              <div className="mt-3 rounded-xl border border-line bg-paper-raised">
                <EmptyState compact icon={<Cpu strokeWidth={1.75} />} title="No AI models to show" description="AIOS lists none at the moment. When one is listed, it appears here." />
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-3" aria-label="AI models">
                {listed.map((entry) => {
                  const mine = installed.find((m) => m.catalogue_entry_id === entry.entry_id)
                  const isCurrent = !!update && update.current.id === mine?.id
                  const replaced = entry.replaces ? catalogueEntry(entry.replaces) : undefined
                  return (
                    <li key={entry.entry_id} className={mine && entry.replaces ? 'animate-fade' : undefined}>
                      <ModelCard
                        entry={entry}
                        installed={mine}
                        suggested={suggested?.entry_id === entry.entry_id}
                        newerAvailable={isCurrent && update.phase !== 'ready' ? update.entry : undefined}
                        onSeeUpdate={seeUpdate}
                        supersededBy={mine ? newerInstalledFor(entry, installed) : undefined}
                        newerVersionOf={!mine && replaced && listed.some((e) => e.entry_id === replaced.entry_id) ? replaced : undefined}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-4 max-w-3xl px-1 text-xs leading-4.5 text-ink-50">
              AIOS lists only AI models it has checked. Each one is downloaded directly from its publisher when you install it, and AIOS checks it is the genuine, unmodified file before using it. When a newer one is listed, it appears on this page.
            </p>
          </section>
        </div>
      </PageBody>
    </div>
  )
}

/** The catalogue entry of a newer version of `entry` that is installed as well, if there is one. */
function newerInstalledFor(entry: CatalogueEntry, installed: InstalledModel[]): CatalogueEntry | undefined {
  return CATALOGUE.find((e) => e.replaces === entry.entry_id && installed.some((m) => m.catalogue_entry_id === e.entry_id))
}

/* ---------------- In use ---------------- */

/** The AI model new conversations use: what it is good for, and how it runs on this computer. */
function InUse({ installed }: { installed: InstalledModel[] }) {
  const defaultId = useStore((s) => s.settings.default_model_id)
  const hardware = useStore((s) => s.hardware)
  const onGraphics = useStore((s) => s.health.engine_build === 'vulkan')
  const model = installed.find((m) => m.id === defaultId)

  if (!model) {
    return (
      <section aria-labelledby="models-in-use" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="flex items-start gap-4 p-6">
          <ArtTile src={ART.model} size="xl" dimmed />
          <div className="min-w-0 flex-1">
            <div className="label-mono">In use</div>
            <h2 id="models-in-use" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
              No AI model chosen
            </h2>
            <p className="mt-1 max-w-md text-sm leading-5 text-ink-soft">New conversations need one. Press Use this one on an installed AI model below.</p>
          </div>
        </div>
      </section>
    )
  }

  const entry = catalogueEntry(model.catalogue_entry_id)
  const fit = entry ? fitFor(entry, hardware, true) : undefined
  // A speed test belongs to the AI model it ran on.
  const measured = hardware.benchmark?.model_id === model.id ? hardware.benchmark : undefined
  const speed = speedWords(measured)

  return (
    <section aria-labelledby="models-in-use" className="@container overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="flex flex-col @3xl:flex-row">
        <div className="flex min-w-0 flex-1 items-start gap-4 p-6">
          <ArtTile key={`logo-${model.id}`} src={modelLogo(model.name)} size="xl" className="animate-fade" />
          {/* Keyed on the model so a switch made below arrives here with a short fade. */}
          <div key={model.id} className="min-w-0 flex-1 animate-fade">
            <div className="label-mono">In use</div>
            <h2 id="models-in-use" className="mt-1.5 text-2xl font-semibold leading-8 tracking-[-0.01em] text-ink">
              {modelLabel(model)}
            </h2>
            <p className="mt-1 max-w-md text-sm leading-5 text-ink-soft">{sizeBlurb(model.tier)}</p>
            <p className="mt-3 max-w-md text-sm leading-5 text-ink">
              <span className="label-mono mr-2">Good for</span>
              {sizeExample(model.tier)}
            </p>
          </div>
        </div>

        <dl className="grid shrink-0 grid-cols-1 divide-y divide-line-soft border-t border-line-soft bg-paper-raised @md:grid-cols-2 @md:divide-x @md:divide-y-0 @3xl:w-80 @3xl:grid-cols-1 @3xl:divide-x-0 @3xl:divide-y @3xl:border-l @3xl:border-t-0">
          <div className="min-w-0 px-6 py-4">
            <dt className="label-mono">On this computer</dt>
            <dd className="mt-1.5">
              {fit && (
                <span className={cn('flex items-center gap-2 text-sm font-medium leading-5', fit.fit === 'slowly' ? 'text-brass-text' : 'text-ink')}>
                  <StatusDot tone={FIT_TONE[fit.fit]} />
                  {fit.line}
                </span>
              )}
              <span className="mt-0.5 block text-xs leading-4.5 text-ink-50">{onGraphics ? 'AIOS is using your graphics card.' : 'AIOS is using your processor.'}</span>
            </dd>
          </div>
          <div className="min-w-0 px-6 py-4">
            <dt className="label-mono">Speed</dt>
            <dd className="mt-1.5">
              <span className="block text-sm font-medium leading-5 text-ink">{speed.headline}</span>
              <span className="mt-0.5 block text-xs leading-4.5 text-ink-50">
                {measured ? (
                  speed.line
                ) : (
                  <Link to="/settings/computer" className={quietLink}>
                    Run a speed test
                  </Link>
                )}
              </span>
            </dd>
          </div>
        </dl>
      </div>
      <p className="border-t border-line-soft px-6 py-2.5 text-xs leading-4.5 text-ink-soft">
        New conversations use this one.{' '}
        {installed.length > 1 ? 'To change it, press Use this one on another installed AI model below.' : 'Install another below and you can switch between them at any time.'} You can also pick a different one inside any conversation.
      </p>
    </section>
  )
}

/* ---------------- Nothing installed yet ---------------- */

/** The first install: say why one is needed, suggest the one that fits, and offer it as the one primary action. */
function FirstInstall({ suggested, cannotRun }: { suggested?: CatalogueEntry; cannotRun: boolean }) {
  const download = useStore((s) => (suggested ? s.downloads[suggested.entry_id] : undefined))
  const busy = !!download && download.status !== 'done'

  return (
    <section aria-labelledby="models-in-use" className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-6 p-6 sm:p-8">
        <div className="min-w-[min(100%,20rem)] flex-1">
          <div className="label-mono">In use</div>
          <h2 id="models-in-use" className="mt-2 font-display text-3xl text-ink">
            {cannotRun ? 'This computer cannot run an AI model' : 'Choose your first AI model'}
          </h2>
          <p className="mt-2 max-w-md text-base leading-[1.375rem] text-ink-soft">
            {cannotRun
              ? `AIOS needs at least ${MINIMUM_PROFILE.ram_gb} GB of memory and ${MINIMUM_PROFILE.free_disk_gb} GB of free space. Everything except chat still works.`
              : 'Chat needs one. Everything else works without it. AIOS downloads it once from its publisher, checks it is the genuine, unmodified file, then it runs on this computer.'}
          </p>
        </div>
        {suggested && !cannotRun && (
          <div className="w-full shrink-0 rounded-lg border border-line bg-paper-raised p-4 sm:w-80">
            <div className="label-mono">Recommended for this computer</div>
            <div className="mt-1.5 text-md font-semibold text-ink">{modelLabel(suggested)}</div>
            <p className="mt-0.5 text-sm leading-5 text-ink-soft">
              <span className="text-ink">Good for:</span> {sizeExample(suggested.tier)}
            </p>
            <div className="mt-3.5" aria-live="polite">
              {busy ? (
                <p className="text-sm leading-5 text-ink-soft">Installing. You can follow it on its card below.</p>
              ) : (
                <Button variant="primary" className="w-full" leading={<Download className="size-4" />} onClick={() => api.models.download(suggested.entry_id)}>
                  Install <span className="font-normal opacity-80 tabular">· {formatBytes(suggested.size_bytes)}</span>
                </Button>
              )}
            </div>
            <p className="mt-2 text-center text-xs leading-4.5 text-ink-50">Or choose a different one below.</p>
          </div>
        )}
      </div>
    </section>
  )
}
