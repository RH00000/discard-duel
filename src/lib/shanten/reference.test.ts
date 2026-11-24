/**
 * Cross-checks shanten() against the Python `mahjong` package on 25,000 seeded random hands.
 * Fixtures come from scripts/verify-shanten/generate.py; regenerate there, never edit by hand.
 */
import { expect, it } from 'vitest'
// ?raw keeps this out of Node APIs (src/ is typed as browser/Worker code) and skips type inference on 1.2 MB of JSON.
import fixturesJson from '../../../scripts/verify-shanten/fixtures.json?raw'
import { shanten, tileName } from './index'

interface Fixtures {
  reference: string
  seed: number
  hands: { c: string; s: number }[]
}

const fixtures: Fixtures = JSON.parse(fixturesJson)

const describeHand = (counts: number[]) =>
  counts.flatMap((n, t) => Array<string>(n).fill(tileName(t))).join(' ')

it(`matches ${fixtures.reference} on every fixture hand`, () => {
  expect(fixtures.hands).toHaveLength(25_000)
  const mismatches: string[] = []
  let matched = 0
  for (const { c, s } of fixtures.hands) {
    const counts = [...c].map(Number)
    const ours = shanten(counts)
    if (ours === s) matched++
    else if (mismatches.length < 10) mismatches.push(`${describeHand(counts)}  expected ${s}, got ${ours}`)
  }
  console.log(`shanten reference check: ${matched}/${fixtures.hands.length} match (seed ${fixtures.seed})`)
  if (mismatches.length) {
    console.log(`first ${mismatches.length} mismatches:\n${mismatches.join('\n')}`)
  }
  expect(mismatches).toEqual([])
})
