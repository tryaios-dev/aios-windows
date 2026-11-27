import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { Download, Film, Image as ImageIcon, MoreHorizontal, RotateCcw, Square, Trash2, Wand2 } from 'lucide-react'
import type { MediaItem, MediaKind } from '@aios/bridge-contract'
import { api } from '@/lib/api'
import { selectProject, useStore } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/chips'
import { Callout, EmptyState, Progress, Spinner } from '@/components/ui/feedback'
import { Field, Hint, Input, Select } from '@/components/ui/fields'
import { Card } from '@/components/ui/layout'
import { ConfirmDialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlays'
import {
  DEFAULT_FRAMES,
  IMAGE_SIZES,
  LICENCE_NOTE,
  VIDEO_LENGTHS,
  VIDEO_SIZES,
  isPending,
  isResourceModel,
  modelLabel,
  modelNote,
  pickModel,
  seconds,
  sizeLabel,
  statusLine,
  unavailableText,
} from './options'
import { useMedia, useMediaUrl } from './useMedia'

interface Draft {
  kind: MediaKind
  model: string | undefined
  prompt: string
  negative: string
  size: string
  frames: number
  seed: string
}

const EMPTY: Draft = { kind: 'image', model: undefined, prompt: '', negative: '', size: 'square', frames: DEFAULT_FRAMES, seed: '' }

const textareaClass =
  'w-full resize-y rounded-md border border-line-control bg-white px-3 py-2 text-base leading-6 text-ink placeholder:text-ink-50 transition-[border-color,box-shadow] duration-(--duration-micro) hover:border-line-strong focus:border-green focus:outline-none focus:ring-2 focus:ring-green/20 disabled:bg-paper disabled:text-ink-50'

/**
 * Images & video tab of a project (R-7). Pictures and short videos are made on the company's GPU
 * server: the description leaves this computer, so the first one in a project that does not use
 * the company server asks first (invariant 2). Finished files are kept encrypted in this project.
 */
export function MediaView() {
  const { projectId } = useParams()
  const project = useStore(selectProject(projectId))
  const { status, items, loaded, upsert, drop, reloadStatus } = useMedia(projectId)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)

  const models = useMemo(() => status?.models ?? [], [status])
  const kinds = useMemo(() => new Set(models.map((m) => m.kind)), [models])

  // Start with a model the server has, and switch when the kind changes.
  useEffect(() => {
    if (!models.length) return
    setDraft((d) => (d.model && models.some((m) => m.id === d.model && m.kind === d.kind) ? d : { ...d, model: pickModel(models, d.kind) }))
  }, [models, draft.kind])

  if (!project) return null

  const sizes = draft.kind === 'video' ? VIDEO_SIZES : IMAGE_SIZES
  const size = sizes.find((o) => o.id === draft.size) ?? sizes[0]!
  const seed = draft.seed.trim() === '' ? null : Number(draft.seed)
  const seedInvalid = seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
  // A video resource linked on the Resources page: made by its provider, allowed every time.
  const resourceModel = isResourceModel(draft.model)
  const hasResource = models.some((m) => isResourceModel(m.id))
  const canSend = !!status?.available && !!draft.model && draft.prompt.trim().length > 0 && !seedInvalid && !sending && !project.archived

  const send = async (confirmed: boolean) => {
    if (!draft.model) return
    setSending(true)
    const result = await api.media.create(project.id, {
      kind: draft.kind,
      model: draft.model,
      prompt: draft.prompt.trim(),
      negative_prompt: draft.negative.trim() || null,
      width: size.width,
      height: size.height,
      frames: draft.kind === 'video' ? draft.frames : null,
      seed,
      confirmed,
    })
    setSending(false)
    if (result.ok) {
      upsert(result.item)
      setDraft((d) => ({ ...d, prompt: '', seed: '' }))
    } else if (result.code === 'confirmation_required') {
      setAsking(true)
    }
  }

  const reuse = (item: MediaItem) => {
    const list = item.kind === 'video' ? VIDEO_SIZES : IMAGE_SIZES
    setDraft({
      kind: item.kind,
      model: item.model,
      prompt: item.prompt,
      negative: item.negative_prompt ?? '',
      size: list.find((o) => o.width === item.width && o.height === item.height)?.id ?? list[0]!.id,
      frames: item.frames ?? DEFAULT_FRAMES,
      seed: '',
    })
    document.getElementById('media-prompt')?.focus()
  }

  return (
    <div className="scroll-stable min-h-0 flex-1 overflow-y-auto">
      <div className="flex w-full max-w-[64rem] animate-fade flex-col gap-6 px-5 py-7">
        <div>
          <h2 className="text-lg font-semibold leading-7 text-ink">Images & video</h2>
          <p className="mt-0.5 max-w-2xl text-sm leading-5 text-ink-soft">
            Made on your company’s AI server. Your description leaves this computer; the finished file is kept encrypted in this project.
            {hasResource && ' Hunyuan Video, linked on Add resources to my AI, is made by fal.ai and asks before every video.'}
          </p>
        </div>

        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner /> Checking the company server…
          </div>
        ) : !status.available ? (
          <Callout tone="neutral" title="Pictures and videos can’t be made now" action={<Button size="sm" onClick={() => void reloadStatus()}>Check again</Button>}>
            {unavailableText(status.reason)}
          </Callout>
        ) : (
          <Card raised className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="What to make">
              {(['image', 'video'] as const).map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  role="radio"
                  aria-checked={draft.kind === kind}
                  variant={draft.kind === kind ? 'primary' : 'secondary'}
                  disabled={!kinds.has(kind)}
                  leading={kind === 'image' ? <ImageIcon className="size-3.5" /> : <Film className="size-3.5" />}
                  onClick={() => setDraft((d) => ({ ...d, kind, size: kind === 'video' ? 'landscape' : 'square' }))}
                >
                  {kind === 'image' ? 'Picture' : 'Video'}
                </Button>
              ))}
            </div>

            <Field label="Describe what to make" htmlFor="media-prompt">
              <textarea
                id="media-prompt"
                rows={3}
                maxLength={2000}
                className={textareaClass}
                placeholder={draft.kind === 'video' ? 'A paper boat drifting down a rainy street, slow camera' : 'A lighthouse at sunset, oil painting'}
                value={draft.prompt}
                onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSend) void send(false)
                }}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Model" htmlFor="media-model">
                <Select
                  id="media-model"
                  value={draft.model}
                  onValueChange={(model) => setDraft((d) => ({ ...d, model }))}
                  options={models
                    .filter((m) => m.kind === draft.kind)
                    .map((m) => ({ value: m.id, label: modelLabel(m.id), description: modelNote(m.id) }))}
                />
              </Field>
              <Field label="Shape" htmlFor="media-size">
                <Select
                  id="media-size"
                  value={size.id}
                  onValueChange={(id) => setDraft((d) => ({ ...d, size: id }))}
                  options={sizes.map((o) => ({ value: o.id, label: `${o.label} · ${o.width}×${o.height}` }))}
                />
              </Field>
              {draft.kind === 'video' && (
                <Field label="Length" htmlFor="media-length">
                  <Select
                    id="media-length"
                    value={String(draft.frames)}
                    onValueChange={(v) => setDraft((d) => ({ ...d, frames: Number(v) }))}
                    options={
                      resourceModel
                        ? [{ value: String(draft.frames), label: 'About 3½ seconds', description: 'The length Hunyuan Video makes' }]
                        : VIDEO_LENGTHS.map((l) => ({ value: String(l.frames), label: `${l.seconds} seconds`, description: l.note }))
                    }
                  />
                </Field>
              )}
            </div>

            <details className="group">
              <summary className="cursor-pointer select-none text-sm text-ink-soft hover:text-ink">More options</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Leave out" hint={draft.kind === 'image' ? 'Has little effect with the fast picture models.' : 'Things the video should not show.'} htmlFor="media-negative">
                  <Input id="media-negative" maxLength={1000} value={draft.negative} onChange={(e) => setDraft((d) => ({ ...d, negative: e.target.value }))} />
                </Field>
                <Field label="Variation number" hint="The same number and description give the same result. Empty: a new one each time." error={seedInvalid ? 'A whole number from 0 to 4294967295.' : undefined} htmlFor="media-seed">
                  <Input id="media-seed" inputMode="numeric" mono value={draft.seed} onChange={(e) => setDraft((d) => ({ ...d, seed: e.target.value }))} />
                </Field>
              </div>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Hint className="max-w-xl">{LICENCE_NOTE}</Hint>
              <Button variant="primary" leading={<Wand2 className="size-3.5" />} disabled={!canSend} loading={sending} onClick={() => void send(false)}>
                {draft.kind === 'video' ? 'Make video' : 'Make picture'}
              </Button>
            </div>
          </Card>
        )}

        {loaded && items.length === 0 ? (
          <EmptyState compact icon={<ImageIcon />} title="No pictures or videos yet" description="What you make here is kept in this project, encrypted on this computer." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Pictures and videos">
            {items.map((item) => (
              <MediaCard key={item.id} item={item} onReuse={() => reuse(item)} onChanged={upsert} onDeleted={() => drop(item.id)} />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={resourceModel ? `Allow this video once with ${modelLabel(draft.model!)}?` : 'Send this description to the company server?'}
        description={
          resourceModel
            ? `To make it, your description goes to ${modelLabel(draft.model!)}, run by fal.ai, and leaves this computer. AIOS asks every time. The finished video comes back and is kept encrypted in this project. This is recorded in Activity and counts toward its monthly limit.`
            : 'To make it, your description goes to your company’s AI server and leaves this computer. The finished file comes back and is kept encrypted in this project. This is recorded in Activity.'
        }
        confirmLabel={resourceModel ? 'Allow once and make the video' : draft.kind === 'video' ? 'Send and make the video' : 'Send and make the picture'}
        onConfirm={() => {
          setAsking(false)
          void send(true)
        }}
      />
    </div>
  )
}

function MediaCard({ item, onReuse, onChanged, onDeleted }: { item: MediaItem; onReuse: () => void; onChanged: (item: MediaItem) => void; onDeleted: () => void }) {
  const url = useMediaUrl(item)
  const [deleting, setDeleting] = useState(false)
  const pending = isPending(item)
  const ratio = `${item.width} / ${item.height}`

  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-line bg-paper-raised">
      <div className="relative flex items-center justify-center bg-paper-deep" style={{ aspectRatio: ratio }}>
        {item.status === 'done' && url ? (
          item.kind === 'video' ? (
            <video src={url} controls loop playsInline className="h-full w-full object-contain" aria-label={item.prompt} />
          ) : (
            <img src={url} alt={item.prompt} className="h-full w-full object-contain" />
          )
        ) : item.status === 'done' ? (
          <Spinner label="Opening" />
        ) : (
          <div className="flex w-full flex-col items-center gap-2 px-5 text-center">
            {pending && <Spinner label="Working" />}
            <p className={cn('text-sm leading-5', item.status === 'failed' ? 'text-deny' : 'text-ink-soft')}>{statusLine(item)}</p>
            {item.status === 'running' && <Progress value={item.progress * 100} label="Progress" className="max-w-48" />}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm leading-5 text-ink" title={item.prompt}>{item.prompt}</p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge tone="neutral" icon={item.kind === 'video' ? <Film /> : <ImageIcon />}>{modelLabel(item.model)}</Badge>
            <span className="truncate text-2xs text-ink-50">
              {sizeLabel(item)}
              {item.kind === 'video' ? ` · ${seconds(item.frames)} s` : ''}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {pending && (
              <Button size="sm" variant="ghost" leading={<Square className="size-3" />} onClick={async () => { const out = await api.media.cancel(item.id); if (out) onChanged(out) }}>
                Stop
              </Button>
            )}
            {item.status === 'done' && (
              <Button size="sm" variant="ghost" leading={<Download className="size-3.5" />} onClick={() => void api.media.save(item.id)}>
                Save
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="More">
                  <MoreHorizontal className="size-4" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<RotateCcw />} onSelect={onReuse}>Use this description again</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(true)}>Delete</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={item.kind === 'video' ? 'Delete this video?' : 'Delete this picture?'}
        description={pending ? 'It is still being made; the company server stops it first. This can’t be undone.' : 'It is removed from this project. Copies you saved elsewhere are not touched. This can’t be undone.'}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          setDeleting(false)
          if (await api.media.remove(item.id)) onDeleted()
        }}
      />
    </li>
  )
}
