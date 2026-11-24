/** Pure parts of the "Why?" feature: the system prompt and the structured data the model sees. */
import { bestDiscards, discardOptions } from '../lib/shanten'
import { tileLabel } from '../lib/tile-label'
import type { Round } from '../schemas/game-schema'
import { toCounts } from '../actions/index.js'

export const EXPLAIN_SYSTEM_PROMPT = `You explain the result of one round of a mahjong discard puzzle.

You receive JSON computed by the game's own engine: the 14-tile hand and, for every distinct discard, the shanten after discarding it and its ukeire (the tiles that would lower shanten, with how many copies of each are unseen), plus which discards are optimal and what each player picked.

Rules you must follow:
- Explain ONLY from the numbers in the JSON. Quote shanten and ukeire values exactly as given; never compute, estimate or correct them yourself.
- Do not state mahjong rules, hand shapes, yaku, scoring, defence, or general "efficiency" principles or heuristics unless the JSON's numbers show it directly. Do not speculate about future draws beyond the listed ukeire.
- The only definitions you may use are the ones in the JSON's "definitions" field.
- If a question can't be answered from the data, say so instead of guessing.
- Refer to tiles exactly by the names used in the JSON.
- Plain text, no headings or tables, under 150 words.`

/** The structured data the model sees. Everything is computed here from the stored hand, never taken from the client. */
export function buildExplainInput(round: Pick<Round, 'hand' | 'results'>) {
  const options = discardOptions(toCounts(round.hand))
  const best = new Set(bestDiscards(options).map((o) => o.discard))
  return {
    definitions: {
      shanten: 'how many tiles away from tenpai the hand is after the discard; 0 = tenpai (one tile from complete), -1 = complete',
      ukeire: 'tiles that would lower shanten if drawn next',
      unseen: 'copies of that tile not in this 14-tile hand (4 minus copies held)',
      ranking: 'optimal = lowest shanten after discarding, then most total unseen ukeire',
      points: 'this game scores 3 for an optimal discard, 1 if shanten matches the optimum but ukeire is lower, 0 otherwise, +1 to the fastest optimal pick',
      tileNames: '"1 man"-"9 man", "1 pin"-"9 pin", "1 sou"-"9 sou", and the honors East, South, West, North, White, Green, Red',
    },
    hand: round.hand.map(tileLabel),
    discards: options
      .map((o) => ({
        discard: tileLabel(o.discard),
        shantenAfter: o.shanten,
        ukeire: o.ukeire.map((u) => ({ tile: tileLabel(u.tile), unseen: u.unseen })),
        ukeireTotal: o.ukeireTotal,
        optimal: best.has(o.discard),
      }))
      .sort((a, b) => a.shantenAfter - b.shantenAfter || b.ukeireTotal - a.ukeireTotal),
    playerPicks: (round.results?.players ?? []).map((p) => ({
      pick: p.tile === null ? null : tileLabel(p.tile),
      points: p.points,
    })),
  }
}
