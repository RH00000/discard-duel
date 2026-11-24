const SUITS = ['man', 'pin', 'sou']
const HONORS = ['East', 'South', 'West', 'North', 'White', 'Green', 'Red']

/** What players read: "2 pin", "East". (`tileName` from the shanten lib stays the compact "2p"/"1z" form.) */
export function tileLabel(tile: number): string {
  return tile >= 27 ? HONORS[tile - 27] : `${(tile % 9) + 1} ${SUITS[Math.floor(tile / 9)]}`
}
