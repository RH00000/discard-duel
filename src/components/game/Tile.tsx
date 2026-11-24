import { cn } from '@/components/ui'
import { tileName } from '@/lib/shanten'

const HONORS = ['E', 'S', 'W', 'N', 'Wh', 'Gr', 'Rd']
const SUIT_STYLE = ['text-red-700', 'text-sky-700', 'text-emerald-700', 'text-stone-800']
const SUIT_LABEL = ['man', 'pin', 'sou', '']

interface TileProps {
  tile: number
  selected?: boolean
  dim?: boolean
  onClick?: () => void
  size?: 'sm' | 'md'
}

/** Text-rendered tile (Unicode mahjong glyphs render poorly on Windows). */
export function Tile({ tile, selected, dim, onClick, size = 'md' }: TileProps) {
  const suit = Math.floor(tile / 9)
  const face = suit === 3 ? HONORS[tile - 27] : String((tile % 9) + 1)
  const Comp = onClick ? 'button' : 'span'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={tileName(tile)}
      aria-pressed={onClick ? !!selected : undefined}
      data-tile={tileName(tile)}
      className={cn(
        'inline-flex flex-col items-center justify-center rounded-md border bg-amber-50 font-semibold shadow-sm transition',
        size === 'md' ? 'h-12 w-full text-base sm:h-16 sm:w-11 sm:text-xl' : 'h-10 w-7 text-sm',
        SUIT_STYLE[suit],
        onClick && 'cursor-pointer hover:-translate-y-1',
        selected ? '-translate-y-2 border-primary ring-2 ring-primary' : 'border-stone-300',
        dim && 'opacity-40',
      )}
    >
      <span>{face}</span>
      {size === 'md' && SUIT_LABEL[suit] && <span className="text-[10px] font-normal">{SUIT_LABEL[suit]}</span>}
    </Comp>
  )
}
