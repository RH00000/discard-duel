import { cn } from '@/components/ui'
import { tileName } from '@/lib/shanten'
import { tileLabel } from '@/lib/tile-label'

const HONORS = ['E', 'S', 'W', 'N', 'Wh', 'Gr', 'Rd']
const SUIT_STYLE = ['text-red-700', 'text-sky-700', 'text-emerald-700', 'text-stone-800']
const SUIT_LABEL = ['man', 'pin', 'sou', '']

interface TileProps {
  tile: number
  selected?: boolean
  /** Gold outline: one of the round's best discards. */
  best?: boolean
  onClick?: () => void
  size?: 'sm' | 'md'
}

/** Text-rendered tile (Unicode mahjong glyphs render poorly on Windows), styled like a physical tile. */
export function Tile({ tile, selected, best, onClick, size = 'md' }: TileProps) {
  const suit = Math.floor(tile / 9)
  const face = suit === 3 ? HONORS[tile - 27] : String((tile % 9) + 1)
  const Comp = onClick ? 'button' : 'span'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={tileLabel(tile)}
      aria-pressed={onClick ? !!selected : undefined}
      data-tile={tileName(tile)}
      className={cn(
        // Off-white face with a thicker, darker bottom edge for depth.
        'inline-flex flex-col items-center justify-center rounded-md border border-stone-300 border-b-stone-400 bg-[#fbf8f1] font-semibold shadow-[0_2px_3px_rgba(0,0,0,0.3)] transition-transform',
        size === 'md' ? 'h-12 w-full border-b-[5px] text-base sm:h-16 sm:w-11 sm:text-xl' : 'h-10 w-7 border-b-[3px] text-sm',
        SUIT_STYLE[suit],
        onClick && 'cursor-pointer hover:-translate-y-0.5',
        selected && '-translate-y-1.5 ring-2 ring-primary hover:-translate-y-1.5',
        best && 'ring-[3px] ring-amber-400',
      )}
    >
      <span>{face}</span>
      {size === 'md' && SUIT_LABEL[suit] && <span className="text-[10px] font-normal">{SUIT_LABEL[suit]}</span>}
    </Comp>
  )
}
