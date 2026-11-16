import { cn } from '@/lib/cn'

/**
 * Four small line illustrations, one per part of AIOS. They show the idea
 * rather than decorate: text being written on this computer, work being
 * locked away, something stopped at the edge, entries being recorded.
 *
 * Motion lives in index.css (classes starting `vg-`). Each drawing plays
 * once when it appears and loops only while an ancestor with the class
 * `group/vg` is hovered or focused.
 */

export type VignetteKind = 'model' | 'storage' | 'rules' | 'activity' | 'documents' | 'knowledge' | 'voice' | 'memory' | 'skills' | 'resources'

const INK = '#16211b'
const GREEN = '#1e5f46'
const LINE = '#d9d7ce'
const BRASS = '#a8863c'

export function Vignette({ kind, className }: { kind: VignetteKind; className?: string }) {
  return (
    <svg viewBox="0 0 240 120" className={cn('vg block h-full w-full', className)} aria-hidden focusable="false" preserveAspectRatio="xMidYMid meet">
      {kind === 'model' && <ModelDrawing />}
      {kind === 'storage' && <StorageDrawing />}
      {kind === 'rules' && <RulesDrawing />}
      {kind === 'activity' && <ActivityDrawing />}
      {kind === 'documents' && <DocumentsDrawing />}
      {kind === 'knowledge' && <KnowledgeDrawing />}
      {kind === 'voice' && <VoiceDrawing />}
      {kind === 'memory' && <MemoryDrawing />}
      {kind === 'skills' && <SkillsDrawing />}
      {kind === 'resources' && <ResourcesDrawing />}
    </svg>
  )
}

/** A question goes in; the answer is written out, here. */
function ModelDrawing() {
  return (
    <g>
      {/* this computer */}
      <rect x="44" y="12" width="152" height="88" rx="10" fill="#fff" stroke={LINE} />
      <rect x="92" y="100" width="56" height="5" rx="2.5" fill={LINE} />
      {/* the question */}
      <g className="vg-ask">
        <rect x="118" y="24" width="66" height="17" rx="8.5" fill="#e9efe8" />
        <rect x="127" y="30.5" width="48" height="4" rx="2" fill={GREEN} opacity="0.55" />
      </g>
      {/* the answer, written line by line */}
      <rect className="vg-bar-1" x="58" y="52" width="112" height="4.5" rx="2.25" fill={INK} opacity="0.28" />
      <rect className="vg-bar-2" x="58" y="63" width="124" height="4.5" rx="2.25" fill={INK} opacity="0.28" />
      <rect className="vg-bar-3" x="58" y="74" width="70" height="4.5" rx="2.25" fill={INK} opacity="0.28" />
      <rect className="vg-caret" x="132" y="72" width="2" height="8.5" rx="1" fill={GREEN} />
      {/* the model itself, inside the machine */}
      <g className="vg-core">
        <rect x="56" y="24" width="17" height="17" rx="5" fill={GREEN} />
        <path d="M64.5 28.2l1.5 3 3 1.3-3 1.3-1.5 3-1.5-3-3-1.3 3-1.3z" fill="#fff" />
      </g>
    </g>
  )
}

/** Readable work becomes unreadable to anyone else, and the lock closes. */
function StorageDrawing() {
  const dots = [0, 1, 2, 3, 4, 5, 6]
  return (
    <g>
      <rect x="62" y="20" width="104" height="72" rx="9" fill="#fbfaf7" stroke={LINE} transform="rotate(-5 114 56)" />
      <rect x="66" y="22" width="104" height="72" rx="9" fill="#fff" stroke={LINE} />
      <g className="vg-plain">
        <rect x="80" y="38" width="62" height="4.5" rx="2.25" fill={INK} opacity="0.28" />
        <rect x="80" y="50" width="74" height="4.5" rx="2.25" fill={INK} opacity="0.28" />
        <rect x="80" y="62" width="44" height="4.5" rx="2.25" fill={INK} opacity="0.28" />
      </g>
      <g className="vg-cipher" fill={GREEN}>
        {dots.map((i) => (
          <circle key={`a${i}`} cx={82 + i * 10} cy="40" r="2.1" opacity={i % 3 === 1 ? 0.35 : 0.7} />
        ))}
        {dots.map((i) => (
          <circle key={`b${i}`} cx={82 + i * 10} cy="52" r="2.1" opacity={i % 2 === 0 ? 0.35 : 0.7} />
        ))}
        {dots.slice(0, 5).map((i) => (
          <circle key={`c${i}`} cx={82 + i * 10} cy="64" r="2.1" opacity={i % 3 === 0 ? 0.35 : 0.7} />
        ))}
      </g>
      {/* the lock */}
      <path className="vg-shackle" d="M157 66v-9a11 11 0 0 1 22 0v9" fill="none" stroke={GREEN} strokeWidth="4.5" strokeLinecap="round" />
      <rect x="149" y="64" width="38" height="32" rx="8" fill={GREEN} />
      <circle cx="168" cy="77" r="3.6" fill="#fff" />
      <rect x="166.6" y="78" width="2.8" height="8" rx="1.4" fill="#fff" />
      {/* your key */}
      <g className="vg-seal">
        <circle cx="64" cy="92" r="9.5" fill="#f8f4e8" stroke={BRASS} />
        <circle cx="61.2" cy="92" r="2.6" fill="none" stroke={BRASS} strokeWidth="1.6" />
        <path d="M63.8 92h6.2m-2.4 0v2.6" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </g>
  )
}

/** Something tries to leave and is turned back at the edge; an update is let in. */
function RulesDrawing() {
  return (
    <g>
      {/* the edge of this computer */}
      <rect x="52" y="14" width="136" height="92" rx="16" fill="#fff" fillOpacity="0.7" stroke={GREEN} strokeWidth="1.5" strokeDasharray="5 5" />
      {/* a conversation, inside */}
      <rect x="76" y="44" width="46" height="34" rx="8" fill="#fff" stroke={LINE} />
      <rect x="85" y="54" width="28" height="4" rx="2" fill={INK} opacity="0.28" />
      <rect x="85" y="63" width="18" height="4" rx="2" fill={INK} opacity="0.28" />
      {/* it tries to leave, and comes back */}
      <circle className="vg-probe" cx="134" cy="61" r="4.5" fill={INK} opacity="0.55" />
      {/* the rule, on the edge */}
      <g className="vg-wall">
        <circle cx="188" cy="61" r="11" fill={GREEN} />
        <path d="M183.2 61.3l3.2 3.2 6-6.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* the one thing let in: an update or an AI model */}
      <g className="vg-inbound">
        <rect x="140" y="18" width="20" height="20" rx="6" fill="#e9efe8" stroke={GREEN} strokeOpacity="0.35" />
        <path d="M150 23.5v8m-3.4-3.2 3.4 3.4 3.4-3.4" fill="none" stroke={GREEN} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  )
}

/** One thing after another, each written down in order. */
function ActivityDrawing() {
  const rows = [
    { y: 30, w: 58, cls: '1' },
    { y: 60, w: 74, cls: '2' },
    { y: 90, w: 46, cls: '3' },
  ]
  return (
    <g>
      <line x1="70" y1="22" x2="70" y2="98" stroke={LINE} strokeWidth="1.5" />
      <line className="vg-thread" x1="70" y1="22" x2="70" y2="98" stroke={GREEN} strokeWidth="1.5" strokeDasharray="76" />
      {rows.map((r) => (
        <g key={r.cls}>
          <g className={`vg-row-${r.cls}`}>
            <rect x="88" y={r.y - 11} width="102" height="22" rx="7" fill="#fff" stroke={LINE} />
            <rect x="98" y={r.y - 2.25} width={r.w} height="4.5" rx="2.25" fill={INK} opacity="0.28" />
            <rect x="166" y={r.y - 2} width="16" height="4" rx="2" fill={INK} opacity="0.14" />
          </g>
          <circle cx="70" cy={r.y} r="6.5" fill="#fff" stroke={LINE} strokeWidth="1.5" />
          <g className={`vg-node-${r.cls}`}>
            <circle cx="70" cy={r.y} r="6.5" fill={GREEN} />
            <path d={`M66.9 ${r.y + 0.2}l2.2 2.2 4-4.4`} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      ))}
    </g>
  )
}

/** A page is read from top to bottom: a band of light passes down it and the lines it has read turn green. */
function DocumentsDrawing() {
  const lines = [
    { y: 34, w: 64, cls: '1' },
    { y: 46, w: 76, cls: '1' },
    { y: 58, w: 52, cls: '2' },
    { y: 70, w: 72, cls: '2' },
    { y: 82, w: 40, cls: '3' },
  ]
  return (
    <g>
      <rect x="60" y="20" width="96" height="84" rx="9" fill="#fbfaf7" stroke={LINE} transform="rotate(-6 108 62)" />
      <rect x="70" y="16" width="100" height="88" rx="9" fill="#fff" stroke={LINE} />
      <path d="M152 16v12a6 6 0 0 0 6 6h12" fill="none" stroke={LINE} />
      {lines.map((l) => (
        <g key={l.y}>
          <rect x="82" y={l.y} width={l.w} height="4.5" rx="2.25" fill={INK} opacity="0.2" />
          <rect className={`vg-row-${l.cls}`} x="82" y={l.y} width={l.w} height="4.5" rx="2.25" fill={GREEN} opacity="0.75" />
        </g>
      ))}
      {/* the reader */}
      <rect className="vg-scan" x="70" y="26" width="100" height="12" rx="3" fill={GREEN} opacity="0.14" />
      <g className="vg-seal">
        <circle cx="176" cy="96" r="11" fill={GREEN} />
        <path d="M171.2 96.3l3.2 3.2 6-6.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  )
}

/** Separate documents become one connected body of knowledge. */
function KnowledgeDrawing() {
  const cards = [
    { x: 46, y: 22, cls: '1' },
    { x: 150, y: 16, cls: '2' },
    { x: 158, y: 70, cls: '3' },
    { x: 40, y: 72, cls: '2' },
  ]
  return (
    <g>
      {/* the links */}
      <g className="vg-thread" stroke={GREEN} strokeWidth="1.5" strokeDasharray="76" fill="none" strokeLinecap="round">
        <path d="M82 38 L112 56" />
        <path d="M150 34 L128 56" />
        <path d="M158 82 L128 66" />
        <path d="M76 84 L112 66" />
      </g>
      {cards.map((c) => (
        <g key={`${c.x}-${c.y}`} className={`vg-row-${c.cls}`}>
          <rect x={c.x} y={c.y} width="42" height="30" rx="7" fill="#fff" stroke={LINE} />
          <rect x={c.x + 8} y={c.y + 9} width="24" height="3.5" rx="1.75" fill={INK} opacity="0.26" />
          <rect x={c.x + 8} y={c.y + 17} width="16" height="3.5" rx="1.75" fill={INK} opacity="0.26" />
        </g>
      ))}
      {/* the store they belong to */}
      <g className="vg-core">
        <rect x="105" y="45" width="30" height="30" rx="9" fill={GREEN} />
        <rect x="113" y="59" width="14" height="10" rx="2.5" fill="#fff" />
        <path d="M116 59v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </g>
  )
}

/** Speech becomes text. */
function VoiceDrawing() {
  const bars = [14, 26, 40, 22, 48, 30, 18, 36, 24, 12]
  return (
    <g>
      <rect x="40" y="40" width="26" height="40" rx="13" fill={GREEN} />
      <path d="M33 62a20 20 0 0 0 40 0M53 82v9m-8 0h16" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" />
      {bars.map((h, i) => (
        <rect key={i} className={`vg-wave vg-wave-${(i % 4) + 1}`} x={84 + i * 7} y={60 - h / 2} width="3.5" height={h} rx="1.75" fill={INK} opacity="0.35" />
      ))}
      {/* what was said, written down */}
      <rect x="160" y="42" width="48" height="36" rx="8" fill="#fff" stroke={LINE} />
      <rect className="vg-bar-1" x="168" y="51" width="32" height="4" rx="2" fill={INK} opacity="0.28" />
      <rect className="vg-bar-2" x="168" y="59" width="26" height="4" rx="2" fill={INK} opacity="0.28" />
      <rect className="vg-bar-3" x="168" y="67" width="18" height="4" rx="2" fill={INK} opacity="0.28" />
    </g>
  )
}

/** What was said earlier is kept and brought back when it matters. */
function MemoryDrawing() {
  const notes = [
    { x: 46, cls: '1' },
    { x: 100, cls: '2' },
    { x: 154, cls: '3' },
  ]
  return (
    <g>
      <line x1="40" y1="84" x2="200" y2="84" stroke={LINE} strokeWidth="1.5" />
      <line className="vg-thread" x1="40" y1="84" x2="200" y2="84" stroke={GREEN} strokeWidth="1.5" strokeDasharray="160" />
      {notes.map((n) => (
        <g key={n.x}>
          <g className={`vg-row-${n.cls}`}>
            <rect x={n.x} y="26" width="40" height="40" rx="8" fill="#fff" stroke={LINE} />
            <rect x={n.x + 8} y="37" width="24" height="3.5" rx="1.75" fill={INK} opacity="0.26" />
            <rect x={n.x + 8} y="45" width="18" height="3.5" rx="1.75" fill={INK} opacity="0.26" />
            <rect x={n.x + 8} y="53" width="12" height="3.5" rx="1.75" fill={INK} opacity="0.26" />
            <line x1={n.x + 20} y1="66" x2={n.x + 20} y2="78" stroke={LINE} strokeWidth="1.5" />
          </g>
          <circle cx={n.x + 20} cy="84" r="5.5" fill="#fff" stroke={LINE} strokeWidth="1.5" />
          <circle className={`vg-node-${n.cls}`} cx={n.x + 20} cy="84" r="5.5" fill={GREEN} />
        </g>
      ))}
    </g>
  )
}

/** A new ability is slotted into the AI. */
function SkillsDrawing() {
  return (
    <g>
      {/* the AI */}
      <rect x="92" y="34" width="56" height="56" rx="14" fill={GREEN} />
      <path d="M120 49l3.6 7.4 7.4 3.2-7.4 3.2-3.6 7.4-3.6-7.4-7.4-3.2 7.4-3.2z" fill="#fff" />
      {/* abilities it already has */}
      <g className="vg-row-1">
        <rect x="40" y="26" width="34" height="26" rx="7" fill="#fff" stroke={LINE} />
        <rect x="48" y="34" width="18" height="3.5" rx="1.75" fill={INK} opacity="0.26" />
        <rect x="48" y="41" width="12" height="3.5" rx="1.75" fill={INK} opacity="0.26" />
        <path d="M74 42 L92 52" stroke={GREEN} strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <g className="vg-row-2">
        <rect x="40" y="70" width="34" height="26" rx="7" fill="#fff" stroke={LINE} />
        <path d="M49 88v-6m6 6v-11m6 11v-8" stroke={INK} strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round" />
        <path d="M74 80 L92 72" stroke={GREEN} strokeWidth="1.5" strokeLinecap="round" />
      </g>
      {/* a new one arrives and clicks into place */}
      <g className="vg-plug">
        <rect x="166" y="47" width="36" height="30" rx="8" fill="#e9efe8" stroke={GREEN} strokeOpacity="0.45" />
        <path d="M178 62h12m-6-6v12" stroke={GREEN} strokeWidth="2" strokeLinecap="round" />
        <path d="M148 62 H166" stroke={GREEN} strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <g className="vg-seal">
        <circle cx="202" cy="47" r="8.5" fill={GREEN} />
        <path d="M198.2 47.2l2.6 2.6 4.8-5.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  )
}

/** This computer borrows power from a bigger one, through a gate you control. */
function ResourcesDrawing() {
  return (
    <g>
      {/* this computer */}
      <rect x="34" y="40" width="58" height="40" rx="8" fill="#fff" stroke={LINE} />
      <rect x="50" y="80" width="26" height="4" rx="2" fill={LINE} />
      <rect x="44" y="50" width="26" height="4" rx="2" fill={INK} opacity="0.26" />
      <rect x="44" y="59" width="36" height="4" rx="2" fill={INK} opacity="0.26" />
      {/* the line out, and the gate on it */}
      <line x1="92" y1="60" x2="156" y2="60" stroke={GREEN} strokeWidth="1.5" strokeDasharray="4 4" />
      <circle className="vg-probe" cx="96" cy="60" r="4" fill={GREEN} />
      <g className="vg-wall">
        <circle cx="124" cy="60" r="11" fill="#fff" stroke={GREEN} strokeWidth="1.5" />
        <path d="M119.2 60.3l3.2 3.2 6-6.6" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* the bigger computer */}
      <g className="vg-core">
        <rect x="156" y="26" width="50" height="68" rx="9" fill={GREEN} />
        <rect x="164" y="36" width="34" height="5" rx="2.5" fill="#fff" opacity="0.85" />
        <rect x="164" y="48" width="34" height="5" rx="2.5" fill="#fff" opacity="0.6" />
        <rect x="164" y="60" width="34" height="5" rx="2.5" fill="#fff" opacity="0.6" />
        <circle cx="168" cy="80" r="3" fill="#fff" />
        <circle cx="178" cy="80" r="3" fill="#fff" opacity="0.6" />
      </g>
    </g>
  )
}
