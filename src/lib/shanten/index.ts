/**
 * Riichi shanten + ukeire for closed hands. Pure TypeScript, no DeepSpace imports.
 *
 * Tiles are indices 0–33: 0–8 man, 9–17 pin, 18–26 sou, 27–33 honors (ESWN, white, green, red).
 * A hand is a 34-length array of counts. Shanten: 0 = tenpai, -1 = complete.
 */

export type Counts = number[]

const SUITS = ['m', 'p', 's', 'z'] as const

/** Parse '123m456p789s11z' into 34-index counts. */
export function hand(text: string): Counts {
  const counts = new Array<number>(34).fill(0)
  let digits: number[] = []
  for (const ch of text.replace(/\s+/g, '')) {
    if (ch >= '0' && ch <= '9') {
      digits.push(Number(ch))
      continue
    }
    const suit = SUITS.indexOf(ch as (typeof SUITS)[number])
    if (suit < 0) throw new Error(`bad tile suit "${ch}" in "${text}"`)
    for (const d of digits) {
      if (d < 1 || d > (suit === 3 ? 7 : 9)) throw new Error(`bad tile ${d}${ch}`)
      counts[suit * 9 + d - 1]++
    }
    digits = []
  }
  if (digits.length) throw new Error(`trailing digits without suit in "${text}"`)
  return counts
}

/** Short name like '5m' or '7z' for tile index. */
export function tileName(tile: number): string {
  return `${(tile % 9) + 1}${SUITS[Math.floor(tile / 9)]}`
}

const isHonor = (i: number) => i >= 27
const isTerminalOrHonor = (i: number) => isHonor(i) || i % 9 === 0 || i % 9 === 8

function standardShanten(counts: Counts): number {
  const c = counts.slice()
  let best = 8
  // Recursive decomposition: at the first nonzero tile, try each way to use it.
  const scan = (i: number, m: number, t: number, p: number): void => {
    while (i < 34 && c[i] === 0) i++
    if (i >= 34) {
      const blocks = Math.min(t, 4 - m)
      best = Math.min(best, 8 - 2 * m - blocks - p)
      return
    }
    const suited = !isHonor(i)
    const pos = i % 9
    if (c[i] >= 3) {
      c[i] -= 3; scan(i, m + 1, t, p); c[i] += 3
    }
    if (suited && pos <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; scan(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++
    }
    if (c[i] >= 2) {
      c[i] -= 2
      if (p === 0) scan(i, m, t, 1)
      scan(i, m, t + 1, p)
      c[i] += 2
    }
    if (suited && pos <= 7 && c[i + 1]) {
      c[i]--; c[i + 1]--; scan(i, m, t + 1, p); c[i]++; c[i + 1]++
    }
    if (suited && pos <= 6 && c[i + 2]) {
      c[i]--; c[i + 2]--; scan(i, m, t + 1, p); c[i]++; c[i + 2]++
    }
    // Treat one copy as isolated.
    c[i]--; scan(i, m, t, p); c[i]++
  }
  scan(0, 0, 0, 0)
  return best
}

export function chiitoitsuShanten(counts: Counts): number {
  let pairs = 0
  let kinds = 0
  for (const n of counts) {
    if (n >= 1) kinds++
    if (n >= 2) pairs++
  }
  return 6 - pairs + Math.max(0, 7 - kinds)
}

export function kokushiShanten(counts: Counts): number {
  let kinds = 0
  let pair = 0
  counts.forEach((n, i) => {
    if (!isTerminalOrHonor(i) || n === 0) return
    kinds++
    if (n >= 2) pair = 1
  })
  return 13 - kinds - pair
}

export function shanten(counts: Counts): number {
  return Math.min(standardShanten(counts), chiitoitsuShanten(counts), kokushiShanten(counts))
}

export interface Ukeire {
  tile: number
  /** Copies not visible in the 14-tile hand (4 minus copies held). */
  unseen: number
}

export interface DiscardOption {
  discard: number
  shanten: number
  ukeire: Ukeire[]
  ukeireTotal: number
}

/** For each distinct tile in a 14-tile hand: shanten after discarding it, plus ukeire. */
export function discardOptions(counts14: Counts): DiscardOption[] {
  const total = counts14.reduce((a, b) => a + b, 0)
  if (counts14.length !== 34 || total !== 14) throw new Error(`expected 14 tiles, got ${total}`)
  const c = counts14.slice()
  const options: DiscardOption[] = []
  for (let d = 0; d < 34; d++) {
    if (!c[d]) continue
    c[d]--
    const s = shanten(c)
    const ukeire: Ukeire[] = []
    for (let t = 0; t < 34; t++) {
      const unseen = 4 - counts14[t]
      if (unseen <= 0) continue
      c[t]++
      if (shanten(c) < s) ukeire.push({ tile: t, unseen })
      c[t]--
    }
    c[d]++
    options.push({ discard: d, shanten: s, ukeire, ukeireTotal: ukeire.reduce((a, u) => a + u.unseen, 0) })
  }
  return options
}

/** Optimal discards: lowest shanten, then highest ukeire. */
export function bestDiscards(options: DiscardOption[]): DiscardOption[] {
  const minS = Math.min(...options.map((o) => o.shanten))
  const atMin = options.filter((o) => o.shanten === minS)
  const maxU = Math.max(...atMin.map((o) => o.ukeireTotal))
  return atMin.filter((o) => o.ukeireTotal === maxU)
}
