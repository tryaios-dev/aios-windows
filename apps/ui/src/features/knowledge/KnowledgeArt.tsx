import { motion, useReducedMotion, type Transition } from 'motion/react'
import { cn } from '@/lib/cn'
import { fileEnding } from '@/data/knowledge'

const INK = '#16211b'
const GREEN = '#1e5f46'
const LINE = '#d9d7ce'

/* ---------------- The idea of the page, drawn ---------------- */

/** One pass: the store empties, a copy lifts off the original and travels across, turns unreadable, and the lock closes. */
const PASS: Transition = { duration: 4.4, times: [0, 0.1, 0.5, 0.6, 0.72, 0.84, 1], repeat: Infinity, ease: 'easeInOut' }
const SETTLE: Transition = { duration: 0.2 }

const CIPHER_ROWS = [
  { y: 59, n: 5 },
  { y: 70, n: 5 },
  { y: 81, n: 4 },
  { y: 92, n: 3 },
]

function PageLines({ x, y }: { x: number; y: number }) {
  return (
    <g fill={INK} opacity="0.28">
      <rect x={x} y={y} width="36" height="4" rx="2" />
      <rect x={x} y={y + 10} width="28" height="4" rx="2" />
      <rect x={x} y={y + 20} width="34" height="4" rx="2" />
    </g>
  )
}

/**
 * A document in its folder on the left; an encrypted copy of it in a locked
 * store on the right. The original never leaves the folder. The drawing is
 * still until `playing`, which the page sets while the pointer is on the drop
 * area or files are being dragged over it; it always rests on the finished
 * picture, which is also what people who prefer less motion see.
 */
export function StoreDrawing({ playing = false, className }: { playing?: boolean; className?: string }) {
  const reduced = useReducedMotion()
  const play = playing && !reduced
  const transition = play ? PASS : SETTLE
  return (
    <svg viewBox="0 0 360 160" className={cn('block h-auto w-full', className)} aria-hidden focusable="false" preserveAspectRatio="xMidYMid meet">
      {/* the folder, with the original in it */}
      <path d="M22 56a7 7 0 0 1 7-7h24l9 9h53a7 7 0 0 1 7 7v52a7 7 0 0 1-7 7H29a7 7 0 0 1-7-7z" fill="#efede6" stroke={LINE} />
      <rect x="44" y="30" width="56" height="72" rx="6" fill="#fff" stroke={LINE} />
      <PageLines x={54} y={43} />
      <path d="M22 82a7 7 0 0 1 7-7h86a7 7 0 0 1 7 7v35a7 7 0 0 1-7 7H29a7 7 0 0 1-7-7z" fill="#fbfaf7" stroke={LINE} />
      <rect x="34" y="88" width="30" height="4" rx="2" fill={INK} opacity="0.12" />

      {/* a copy is made */}
      <g fill="none" stroke={GREEN} strokeLinecap="round" strokeLinejoin="round">
        <path d="M134 80h26M190 80h20" strokeWidth="1.5" strokeDasharray="1 5.5" opacity="0.6" />
        <path d="M207 74.5l6 5.5-6 5.5" strokeWidth="1.5" opacity="0.75" />
      </g>
      <circle cx="175" cy="80" r="11.5" fill="#fff" stroke={LINE} />
      <rect x="173" y="74.5" width="7" height="8.5" rx="1.75" fill="#fff" stroke={GREEN} strokeWidth="1.4" />
      <rect x="170" y="77" width="7" height="8.5" rx="1.75" fill="#fff" stroke={GREEN} strokeWidth="1.4" />

      {/* the store on this computer */}
      <rect x="228" y="28" width="112" height="104" rx="18" fill="#f1f5f1" stroke={GREEN} strokeOpacity="0.3" strokeWidth="1.5" />
      <motion.g initial={false} animate={{ opacity: play ? [1, 0, 0, 1, 1, 1, 1] : 1 }} transition={transition}>
        <rect x="248" y="44" width="56" height="72" rx="6" fill="#fff" stroke={LINE} />
        <motion.g initial={false} animate={{ opacity: play ? [0, 1, 1, 1, 0, 0, 0] : 0 }} transition={transition}>
          <PageLines x={258} y={57} />
        </motion.g>
        <motion.g initial={false} fill={GREEN} animate={{ opacity: play ? [1, 0, 0, 0, 1, 1, 1] : 1 }} transition={transition}>
          {CIPHER_ROWS.map((row, r) =>
            Array.from({ length: row.n }, (_, i) => <circle key={`${r}-${i}`} cx={259 + i * 9} cy={row.y} r="2" opacity={(i + r) % 3 === 1 ? 0.35 : 0.7} />),
          )}
        </motion.g>
      </motion.g>

      {/* the copy on its way; the original stays behind */}
      <motion.g
        initial={false}
        animate={play ? { x: [0, 0, 204, 204, 204, 204, 0], y: [0, -8, 14, 14, 14, 14, 0], opacity: [0, 1, 1, 0, 0, 0, 0] } : { x: 0, y: 0, opacity: 0 }}
        transition={transition}
      >
        <rect x="44" y="30" width="56" height="72" rx="6" fill="#fff" stroke={GREEN} strokeOpacity="0.45" />
        <PageLines x={54} y={43} />
      </motion.g>

      {/* the lock */}
      <motion.path d="M308 98v-8a10 10 0 0 1 20 0v8" fill="none" stroke={GREEN} strokeWidth="4.5" strokeLinecap="round" initial={false} animate={{ y: play ? [0, -7, -7, -7, -7, 0, 0] : 0 }} transition={transition} />
      <rect x="300" y="96" width="36" height="30" rx="8" fill={GREEN} />
      <circle cx="318" cy="108" r="3.4" fill="#fff" />
      <rect x="316.7" y="109" width="2.6" height="7.5" rx="1.3" fill="#fff" />
    </svg>
  )
}

/* ---------------- File-kind tile ---------------- */

interface TileLook {
  label: string
  ink: string
  wash: string
}

/** One look per kind of document, in the colours people already know them by, taken from the AIOS palette. */
const LOOKS: Record<string, TileLook> = {
  PDF: { label: 'PDF', ink: '#8a3b2e', wash: '#faf0ee' },
  Word: { label: 'DOC', ink: '#4b5b66', wash: '#eef1f3' },
  Excel: { label: 'XLS', ink: '#1e5f46', wash: '#e9efe8' },
  Table: { label: 'CSV', ink: '#1e5f46', wash: '#e9efe8' },
  PowerPoint: { label: 'PPT', ink: '#7a5f25', wash: '#f8f4e8' },
  Text: { label: 'TXT', ink: '#45514a', wash: '#efede6' },
  'Web page': { label: 'WEB', ink: '#4b5b66', wash: '#eef1f3' },
  Picture: { label: 'IMG', ink: '#6b736e', wash: '#efede6' },
}

/** A small page with the kind written on it: PDF, DOC, XLS, PPT, TXT. The kind is also in words beside it. */
export function FileTile({ name, kind, className }: { name: string; kind: string; className?: string }) {
  const look = LOOKS[kind] ?? { label: (fileEnding(name).slice(0, 3) || 'file').toUpperCase(), ink: '#6b736e', wash: '#efede6' }
  return (
    <span className={cn('relative block h-10 w-[34px] shrink-0', className)} aria-hidden>
      <svg viewBox="0 0 34 40" className="block size-full" fill="none">
        <path d="M7 1.75h13.5l8.75 8.75V34.5a3.75 3.75 0 0 1-3.75 3.75H7a3.75 3.75 0 0 1-3.75-3.75v-29A3.75 3.75 0 0 1 7 1.75z" fill="#fff" stroke={look.ink} strokeOpacity="0.34" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M20.5 1.75v5.5a3.25 3.25 0 0 0 3.25 3.25h5.5z" fill={look.wash} stroke={look.ink} strokeOpacity="0.34" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M8.5 12.5h6.5M8.5 16.5h11" stroke={look.ink} strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="absolute bottom-[6px] left-0 rounded-[3px] px-[3px] font-mono text-2xs font-medium leading-[14px] tracking-[0.02em] text-white" style={{ backgroundColor: look.ink }}>
        {look.label}
      </span>
    </span>
  )
}
