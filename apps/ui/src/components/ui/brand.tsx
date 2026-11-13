import { cn } from '@/lib/cn'
import brandDark from '@/assets/brand/aios-wordmark-brand-dark.svg'
import white from '@/assets/brand/aios-wordmark-white.svg'
import ivory from '@/assets/brand/aios-wordmark-ivory.svg'

// Imported, not referenced as /brand/...: the desktop app loads the page from file://.
const WORDMARK = { 'brand-dark': brandDark, white, ivory } as const

export function Wordmark({ className, variant = 'brand-dark', height = 14 }: { className?: string; variant?: 'brand-dark' | 'white' | 'ivory'; height?: number }) {
  return <img src={WORDMARK[variant]} alt="AIOS" height={height} style={{ height, width: 'auto' }} className={cn('select-none', className)} draggable={false} />
}
