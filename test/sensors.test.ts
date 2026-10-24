import { describe, expect, it } from 'vitest'
import { SENSOR_AREAS } from '../src/core/sensors'
import type { Vec2 } from '../src/core/geometry'

function inside(p: Vec2, poly: Vec2[]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

describe('sensor areas', () => {
  it('has all 33 sensors once', () => {
    const names = SENSOR_AREAS.map((a) => a.name)
    expect(new Set(names).size).toBe(33)
    for (const g of 'ABDE') for (let n = 1; n <= 8; n++) expect(names).toContain(`${g}${n}`)
    expect(names).toContain('C')
  })

  it('puts each label inside its own area', () => {
    for (const a of SENSOR_AREAS) expect(inside(a.centre, a.points), a.name).toBe(true)
  })

  it('places A1 at the upper right and D1 at the top', () => {
    const a1 = SENSOR_AREAS.find((a) => a.name === 'A1')!.centre
    const d1 = SENSOR_AREAS.find((a) => a.name === 'D1')!.centre
    expect(a1.x).toBeGreaterThan(0)
    expect(a1.y).toBeGreaterThan(a1.x)
    expect(Math.abs(d1.x)).toBeLessThan(1e-9)
    expect(d1.y).toBeGreaterThan(4)
  })
})
