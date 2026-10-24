import { describe, expect, it } from 'vitest'
import { segmentQueues, slideQueues, tableName, type JudgeStep } from '../src/core/slideJudge'
import type { SlideSegment, SlideShape } from '../src/parser/types'

const seg = (shape: SlideShape, ...vertices: number[]): SlideSegment => ({ shape, vertices })
const names = (q: JudgeStep[]) => q.map((s) => s.sensors.join('/') + (s.skippable ? '' : '*'))
const one = (start: number, s: SlideSegment) => names(segmentQueues(start, s)![0]!)

describe('slide judge queues', () => {
  it('names tables like DetectShapeFromText', () => {
    expect(tableName(1, seg('-', 5))).toBe('line5')
    expect(tableName(5, seg('>', 3))).toBe('-circle3')
    expect(tableName(1, seg('V', 7, 5))).toBe('L5')
    expect(tableName(1, seg('V', 6, 2))).toBeNull()
    expect(tableName(1, seg('-', 2))).toBeNull()
  })

  it('walks 1-5 through the centre', () => {
    expect(one(1, seg('-', 5))).toEqual(['A1', 'B1', 'C', 'B5', 'A5'])
  })

  it('marks the steps that must be touched', () => {
    expect(one(1, seg('>', 2))).toEqual(['A1*', 'A2'])
    expect(one(1, seg('>', 3))).toEqual(['A1', 'A2*', 'A3'])
    expect(one(1, seg('-', 3))).toEqual(['A1', 'A2/B2*', 'A3'])
    expect(one(1, seg('-', 7))).toEqual(['A1', 'A8/B8*', 'A7'])
    expect(one(7, seg('-', 5))).toEqual(['A7', 'A6/B6*', 'A5'])
    expect(one(1, seg('V', 7, 5))).toEqual(['A1', 'B8/A8*', 'A7', 'B6/A6*', 'A5'])
  })

  it('mirrors rings starting in the lower half', () => {
    expect(one(5, seg('>', 3))).toEqual(['A5', 'A4*', 'A3'])
  })

  it('gives wifi three lanes', () => {
    expect(segmentQueues(1, seg('w', 5))!.map(names)).toEqual([
      ['A1', 'B8', 'B7', 'A6/D6'],
      ['A1', 'B1', 'C', 'A5/B5'],
      ['A1', 'B2', 'B3', 'A4/D5'],
    ])
  })

  it('starts at the start button and ends at the end button for every shape', () => {
    const shapes: [SlideShape, number[]][] = [
      ['-', [3, 4, 5, 6, 7]], ['>', [1, 2, 3, 4, 5, 6, 7, 8]], ['<', [1, 2, 3, 4, 5, 6, 7, 8]],
      ['^', [2, 3, 4, 6, 7, 8]], ['v', [1, 2, 3, 4, 6, 7, 8]], ['p', [1, 2, 3, 4, 5, 6, 7, 8]],
      ['q', [1, 2, 3, 4, 5, 6, 7, 8]], ['pp', [1, 2, 3, 4, 5, 6, 7, 8]], ['qq', [1, 2, 3, 4, 5, 6, 7, 8]],
      ['s', [5]], ['z', [5]],
    ]
    for (let start = 1; start <= 8; start++)
      for (const [shape, ends] of shapes)
        for (const rel of ends) {
          const end = ((start + rel - 2) % 8) + 1
          const q = segmentQueues(start, seg(shape, end))
          expect(q, `${start}${shape}${end}`).not.toBeNull()
          const steps = q![0]!
          expect(steps[0]!.sensors, `${start}${shape}${end}`).toContain(`A${start}`)
          expect(steps[steps.length - 1]!.sensors, `${start}${shape}${end}`).toContain(`A${end}`)
          expect(steps[steps.length - 1]!.last).toBe(true)
        }
  })

  it('applies the connected slide rules', () => {
    // 1-3-5: 3 + 3 - 1 = 5 steps in all, so everything may be skipped
    const long = slideQueues(1, { segments: [seg('-', 3), seg('-', 5)], delay: 0, duration: 1, isBreak: false })!
    expect(long.flatMap((p) => p[0]!).every((s) => s.skippable)).toBe(true)
    expect(long[0]![0]!.at(-1)!.last).toBe(false)
    expect(long[1]![0]!.at(-1)!.last).toBe(true)
    // 1>2>3: 2 + 2 - 1 = 3 steps, head's second and end's first must be touched
    const short = slideQueues(1, { segments: [seg('>', 2), seg('>', 3)], delay: 0, duration: 1, isBreak: false })!
    expect(names(short[0]![0]!)).toEqual(['A1', 'A2*'])
    expect(names(short[1]![0]!)).toEqual(['A2*', 'A3'])
  })
})
