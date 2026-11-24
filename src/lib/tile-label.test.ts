import { expect, it } from 'vitest'
import { tileLabel } from './tile-label'

it('labels suited tiles and honors the way players read them', () => {
  expect([0, 8, 10, 26, 27, 28, 31, 33].map(tileLabel)).toEqual([
    '1 man', '9 man', '2 pin', '9 sou', 'East', 'South', 'White', 'Red',
  ])
})
