import { describe, expect, it } from 'vitest'
import { touchPosition, touchState, touchTiming } from '../src/core/touch'
import { buttonPoint } from '../src/core/geometry'

describe('touch geometry', () => {
  it('puts A/B on the button lines and D/E between them', () => {
    const a1 = touchPosition({ group: 'A', index: 1 })
    const b1 = buttonPoint(1, 4.0)
    expect(a1.x).toBeCloseTo(b1.x)
    expect(a1.y).toBeCloseTo(b1.y)
    const d1 = touchPosition({ group: 'D', index: 1 })
    expect(d1.x).toBeCloseTo(0)
    expect(d1.y).toBeCloseTo(4.1)
    const e3 = touchPosition({ group: 'E', index: 3 })
    expect(e3.x).toBeCloseTo(3.1)
    expect(touchPosition({ group: 'C', index: 1 })).toEqual({ x: 0, y: 0 })
  })

  it('fades in, closes in, and lands at the hit time', () => {
    const t = touchTiming(7.5)
    expect(t.whole).toBeCloseTo(0.469, 2)
    expect(touchState(-t.whole - 0.01, t)).toBeNull()
    expect(touchState(-t.whole + 0.01, t)!.spread).toBe(0.4)
    expect(touchState(-t.whole + 0.01, t)!.alpha).toBeLessThan(0.5)
    expect(touchState(-0.01, t)!.spread).toBeLessThan(0.05)
    expect(touchState(0, t)).toEqual({ alpha: 1, spread: 0 })
  })
})
