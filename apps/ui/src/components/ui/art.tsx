import { cn } from '@/lib/cn'

const SIZES = {
  xs: { tile: 'size-7 rounded-lg', img: 'size-[18px]' },
  sm: { tile: 'size-8 rounded-[9px]', img: 'size-5' },
  md: { tile: 'size-9 rounded-[10px]', img: 'size-[22px]' },
  lg: { tile: 'size-11 rounded-xl', img: 'size-7' },
  xl: { tile: 'size-[52px] rounded-[14px]', img: 'size-8' },
} as const

export type ArtSize = keyof typeof SIZES

/**
 * A colour icon on a small white tile. The picture is decoration: the words
 * beside it always say the same thing, so it is hidden from screen readers.
 * Icons come from `@/assets/icons` (see the notes there on sources).
 */
export function ArtTile({ src, size = 'md', dimmed, className }: { src: string; size?: ArtSize; /** Greyed out: the thing is off, missing or not ready. */ dimmed?: boolean; className?: string }) {
  const s = SIZES[size]
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center border border-line bg-white shadow-[0_1px_2px_rgba(22,33,27,0.06)] transition-[opacity,filter] duration-(--duration-panel) ease-(--ease-out)', s.tile, dimmed && 'opacity-55 grayscale', className)}>
      <img src={src} alt="" draggable={false} className={s.img} />
    </span>
  )
}

/** A colour icon with no tile, for places where it sits in a line of text or a menu row. */
export function Art({ src, className }: { src: string; className?: string }) {
  return <img src={src} alt="" aria-hidden draggable={false} className={cn('size-5 shrink-0', className)} />
}
