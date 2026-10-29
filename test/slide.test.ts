import { describe, expect, it } from 'vitest'
import { buildArrows, pathFromSlideCode, pointA } from '../src/core/slidePath'
import { slideCode } from '../src/core/slideShapes'
import type { SlideShape } from '../src/parser/types'
import { parseSimai } from '../src/parser/simai'
import { prepareChart } from '../src/render/renderer'

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

describe('star tap spin', () => {
  const spinOf = (src: string) => {
    const chart = prepareChart(parseSimai(src), 0)
    return (chart.notes[0]!.spin * 180) / Math.PI
  }

  it('follows MajdataPlay: arrows plus one per part, over the slide time', () => {
    const slide = prepareChart(parseSimai('(120)1-5[4:1],E'), 0).slides[0]!
    const length = slide.parts.reduce((s, p) => s + (p.kind === 'path' ? p.arrows.length - 1 : 20), 0)
    // 1-5 has about 20 bars; [4:1] at 120 bpm is 0.5 s
    expect(spinOf('(120)1-5[4:1],E')).toBeCloseTo(-68.54838709677419 * ((length * 0.47) / 500 / 0.0034803742562305))
  })

  it('turns faster for faster slides, up to 1080°/s', () => {
    expect(spinOf('(120)1-5[2:1],E')).toBeGreaterThan(spinOf('(120)1-5[4:1],E'))
    expect(spinOf('(120)1-5[64:1],E')).toBeCloseTo(-1080)
  })

  it('counts a wifi as 20', () => {
    expect(spinOf('(120)1w5[4:1],E')).toBeCloseTo(-68.54838709677419 * ((20 * 0.47) / 500 / 0.0034803742562305))
  })

  it('leaves $ taps still and spins $$ taps at 440°/s', () => {
    expect(spinOf('(120)1$,E')).toBe(0)
    expect(spinOf('(120)1$$,E')).toBeCloseTo(-440)
  })
})
