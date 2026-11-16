import { Fragment } from 'react'
import { cn } from '@/lib/cn'
import type { MessageRole } from '@/lib/types'

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Renders `text` with every case-insensitive occurrence of `query` wrapped in a green-tint mark. */
export function Highlight({ text, query, className }: { text: string; query: string; className?: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'))
  const lower = q.toLowerCase()
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lower ? (
          <mark key={i} className={cn('bg-green-tint text-ink rounded-xs px-0.5', className)}>
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** Tiny mono label saying who wrote a message: "You" or "Answer". */
export function RoleLabel({ role, className }: { role: MessageRole; className?: string }) {
  return (
    <span className={cn('inline-flex h-4.5 shrink-0 items-center rounded-xs border border-line bg-paper px-1 font-mono text-2xs leading-none text-ink-50', className)}>
      {role === 'user' ? 'You' : 'Answer'}
    </span>
  )
}
