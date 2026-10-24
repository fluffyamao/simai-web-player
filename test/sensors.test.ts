import { describe, expect, it } from 'vitest'
import { SENSOR_AREAS } from '../src/core/sensors'
import type { Vec2 } from '../src/core/geometry'
import { touchPosition } from '../src/core/touch'

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
  it('has all 34 sensors once', () => {
    const names = SENSOR_AREAS.map((a) => a.name)
    expect(new Set(names).size).toBe(34)
    for (const g of 'ABDE') for (let n = 1; n <= 8; n++) expect(names).toContain(`${g}${n}`)
    expect(names).toContain('C1')
    expect(names).toContain('C2')
  })

  it('puts touch positions inside their sensor', () => {
    for (const g of ['A', 'B', 'D', 'E'] as const)
      for (let index = 1; index <= 8; index++) {
        const area = SENSOR_AREAS.find((a) => a.name === `${g}${index}`)!
        expect(inside(touchPosition({ group: g, index }), area.points), area.name).toBe(true)
      }
  })

  it('leaves gaps between neighbouring sensors', () => {
    const a1 = SENSOR_AREAS.find((a) => a.name === 'A1')!
    for (const other of SENSOR_AREAS.filter((a) => a !== a1))
      for (const p of a1.points) expect(inside(p, other.points), other.name).toBe(false)
  })

  it('puts each label inside its own area', () => {
    for (const a of SENSOR_AREAS) expect(inside(a.centre, a.points), a.name).toBe(true)
  })

  it('places A1 at the upper right and D1 at the top', () => {
    const a1 = SENSOR_AREAS.find((a) => a.name === 'A1')!.centre
    const d1 = SENSOR_AREAS.find((a) => a.name === 'D1')!.centre
    expect(a1.x).toBeGreaterThan(0)
    expect(a1.y).toBeGreaterThan(a1.x)
    expect(Math.abs(d1.x)).toBeLessThan(0.01)
    expect(d1.y).toBeGreaterThan(4)
  })
})
