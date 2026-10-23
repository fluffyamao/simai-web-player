import { describe, expect, it } from 'vitest'
import { buildArrows, pathFromSlideCode, pointA } from '../src/core/slidePath'
import { slideCode } from '../src/core/slideShapes'
import type { SlideShape } from '../src/parser/types'

/** Bars in the standard prefabs, from MajRadar StandardSlideBarCounts (start at button 1). */
const PREFAB_BARS: [SlideShape, number, number, number?][] = [
  ['-', 3, 14], ['-', 4, 19], ['-', 5, 20], ['-', 6, 19], ['-', 7, 14],
  ['>', 1, 64], ['>', 2, 8], ['>', 3, 16], ['>', 5, 32], ['>', 8, 56],
  ['<', 8, 8], ['<', 5, 32],
  ['^', 3, 16], ['^', 7, 16],
  ['v', 1, 21], ['v', 3, 20], ['v', 7, 20],
  ['p', 1, 34], ['p', 2, 31], ['p', 3, 28], ['p', 4, 25], ['p', 5, 22], ['p', 6, 43], ['p', 7, 41], ['p', 8, 37],
  ['q', 8, 31], ['q', 5, 22], ['q', 4, 43],
  ['pp', 1, 36], ['pp', 2, 29], ['pp', 3, 23], ['pp', 4, 50], ['pp', 5, 50], ['pp', 6, 49], ['pp', 7, 47], ['pp', 8, 42],
  ['qq', 8, 29], ['qq', 7, 23], ['qq', 6, 50], ['qq', 5, 50], ['qq', 4, 49], ['qq', 1, 36],
  ['s', 5, 31], ['z', 5, 31],
  ['V', 2, 33, 7], ['V', 3, 35, 7], ['V', 4, 33, 7], ['V', 5, 29, 7], ['V', 8, 33, 3],
]

describe('standard slide shapes', () => {
  it.each(PREFAB_BARS)('1%s%s has about %i bars', (shape, end, bars, via) => {
    const code = slideCode(1, { shape, vertices: via ? [via, end] : [end] })
    expect(code).not.toBeNull()
    const arrows = buildArrows(pathFromSlideCode(code!))
    // arrows include the start and end points
    expect(Math.abs(arrows.length - 2 - bars)).toBeLessThanOrEqual(1)
  })

  it('ends where the chart says', () => {
    for (const [shape, end, , via] of PREFAB_BARS) {
      const path = pathFromSlideCode(slideCode(1, { shape, vertices: via ? [via, end] : [end] })!)
      const p = path.pointAt(1)
      const e = pointA(end)
      expect(Math.hypot(p.x - e.x, p.y - e.y)).toBeLessThan(1e-6)
    }
  })

  it('p goes counter-clockwise, through the left side when going 1 to 5', () => {
    const path = pathFromSlideCode(slideCode(1, { shape: 'p', vertices: [5] })!)
    expect(path.pointAt(0.5).x).toBeLessThan(-1)
  })
})
