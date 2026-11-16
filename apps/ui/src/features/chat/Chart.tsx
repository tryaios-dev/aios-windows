import { useMemo, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * Chart maker skill: an answer can hold a ```chart block with the figures as JSON, and it is
 * drawn here as a picture. Only numbers and short labels are drawn; nothing is fetched and no
 * HTML from the answer is used. "Copy as picture" puts a PNG on the clipboard for a document.
 */

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie'
  title?: string
  labels: string[]
  series: { name?: string; values: number[] }[]
}

const MAX_POINTS = 40
const MAX_SERIES = 6
const W = 640
const H = 340
const PAD = { top: 44, right: 20, bottom: 56, left: 64 }
const TOKENS = ['--color-green', '--color-brass-text', '--color-slate', '--color-deny', '--color-green-dark', '--color-ink-soft']

/** The chart in a block, or null when it is not one AIOS can draw (then the text is shown). */
export function parseChart(text: string): ChartSpec | null {
  try {
    const raw = JSON.parse(text) as Partial<ChartSpec>
    const type = raw.type === 'line' || raw.type === 'pie' ? raw.type : raw.type === 'bar' ? 'bar' : null
    if (!type || !Array.isArray(raw.labels) || !Array.isArray(raw.series) || !raw.labels.length) return null
    const labels = raw.labels.slice(0, MAX_POINTS).map((l) => String(l).slice(0, 40))
    const series = raw.series.slice(0, MAX_SERIES).map((s) => ({
      name: typeof s?.name === 'string' ? s.name.slice(0, 40) : undefined,
      values: labels.map((_, i) => Number(Array.isArray(s?.values) ? s.values[i] : NaN)),
    }))
    if (!series.length || series.some((s) => s.values.some((v) => !Number.isFinite(v)))) return null
    return { type, title: typeof raw.title === 'string' ? raw.title.slice(0, 80) : undefined, labels, series }
  } catch {
    return null
  }
}

function palette(): string[] {
  const style = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement)
  return TOKENS.map((t, i) => style?.getPropertyValue(t).trim() || ['#1f6b4f', '#8a6a1f', '#4a5a6a', '#b0413e', '#174f3b', '#555'][i]!)
}

const short = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${+n.toFixed(2)}`)

function Axes({ max, min, ink, soft }: { max: number; min: number; ink: string; soft: string }) {
  const ticks = 4
  const plotH = H - PAD.top - PAD.bottom
  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = min + ((max - min) * i) / ticks
        const y = PAD.top + plotH - (plotH * i) / ticks
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={soft} strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill={ink}>
              {short(v)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Plot({ spec, colors, ink, soft }: { spec: ChartSpec; colors: string[]; ink: string; soft: string }) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  if (spec.type === 'pie') {
    const values = spec.series[0]!.values.map((v) => Math.max(v, 0))
    const total = values.reduce((a, b) => a + b, 0) || 1
    const cx = PAD.left + plotH / 2
    const cy = PAD.top + plotH / 2
    const r = plotH / 2
    let angle = -Math.PI / 2
    return (
      <g>
        {values.map((v, i) => {
          const a0 = angle
          angle += (v / total) * Math.PI * 2
          const large = angle - a0 > Math.PI ? 1 : 0
          const p = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
          const d = values.length === 1 ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0` : `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(angle)} Z`
          return <path key={i} d={d} fill={colors[i % colors.length]} stroke="#fff" strokeWidth={1.5} />
        })}
        {spec.labels.map((l, i) => (
          <g key={l + i} transform={`translate(${cx + r + 32}, ${PAD.top + 8 + i * 20})`}>
            <rect width={10} height={10} y={-9} fill={colors[i % colors.length]} rx={2} />
            <text x={16} fontSize={12} fill={ink}>
              {l} ({Math.round((values[i]! / total) * 100)}%)
            </text>
          </g>
        ))}
      </g>
    )
  }
  const all = spec.series.flatMap((s) => s.values)
  const max = Math.max(...all, 0)
  const min = Math.min(...all, 0)
  const span = max - min || 1
  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH
  const n = spec.labels.length
  const slot = plotW / n
  const showEvery = Math.ceil(n / 12)
  return (
    <g>
      <Axes max={max} min={min} ink={ink} soft={soft} />
      {spec.labels.map((l, i) =>
        i % showEvery === 0 ? (
          <text key={l + i} x={PAD.left + slot * i + slot / 2} y={H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill={ink}>
            {l.length > 12 ? `${l.slice(0, 11)}…` : l}
          </text>
        ) : null,
      )}
      {spec.type === 'bar'
        ? spec.series.map((s, si) => {
            const bw = (slot * 0.7) / spec.series.length
            return s.values.map((v, i) => (
              <rect key={`${si}-${i}`} x={PAD.left + slot * i + slot * 0.15 + bw * si} y={Math.min(y(v), y(0))} width={Math.max(bw - 2, 1)} height={Math.abs(y(v) - y(0))} fill={colors[si % colors.length]} rx={2} />
            ))
          })
        : spec.series.map((s, si) => (
            <g key={si}>
              <polyline fill="none" stroke={colors[si % colors.length]} strokeWidth={2.5} points={s.values.map((v, i) => `${PAD.left + slot * i + slot / 2},${y(v)}`).join(' ')} />
              {s.values.map((v, i) => (
                <circle key={i} cx={PAD.left + slot * i + slot / 2} cy={y(v)} r={3.5} fill={colors[si % colors.length]} />
              ))}
            </g>
          ))}
      {spec.series.length > 1 &&
        spec.series.map((s, si) => (
          <g key={`legend-${si}`} transform={`translate(${PAD.left + si * 130}, ${H - 14})`}>
            <rect width={10} height={10} y={-9} fill={colors[si % colors.length]} rx={2} />
            <text x={16} fontSize={12} fill={ink}>
              {s.name ?? `Series ${si + 1}`}
            </text>
          </g>
        ))}
    </g>
  )
}

/** Draw the SVG onto a canvas and put it on the clipboard as a PNG. */
async function copyPicture(svg: SVGSVGElement): Promise<void> {
  const xml = new XMLSerializer().serializeToString(svg)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = W * 2
  canvas.height = H * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no_canvas')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('no_picture')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export function ChartBlock({ spec }: { spec: ChartSpec }) {
  const ref = useRef<SVGSVGElement>(null)
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const colors = useMemo(palette, [])
  const ink = colors[5]!
  const soft = 'rgba(0,0,0,0.08)'
  const copy = () => {
    if (!ref.current) return
    copyPicture(ref.current).then(
      () => setState('copied'),
      () => setState('failed'),
    )
    window.setTimeout(() => setState('idle'), 2000)
  }
  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex h-8 items-center justify-between border-b border-line-soft bg-paper px-3">
        <span className="label-mono">{spec.type} chart</span>
        <button onClick={copy} className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-ink-50 transition-colors hover:bg-ink-6 hover:text-ink" aria-label="Copy chart as a picture">
          {state === 'copied' ? <Check className="size-3 text-green" /> : <Copy className="size-3" />}
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : 'Copy as picture'}
        </button>
      </div>
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={spec.title ?? `${spec.type} chart`} fontFamily="sans-serif">
        <rect width={W} height={H} fill="#ffffff" />
        {spec.title && (
          <text x={W / 2} y={24} textAnchor="middle" fontSize={15} fontWeight={600} fill={ink}>
            {spec.title}
          </text>
        )}
        <Plot spec={spec} colors={colors} ink={ink} soft={soft} />
      </svg>
    </figure>
  )
}
