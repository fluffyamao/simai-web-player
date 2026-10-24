import { describe, expect, it } from 'vitest'
import { SlideJudge } from '../src/core/slideCheck'
import { runHands, type HandAction, type HandSize } from '../src/core/hands'
import type { SlideSegment, SlideShape } from '../src/parser/types'

const slide = (...segments: SlideSegment[]) => ({ segments, delay: 0, duration: 1, isBreak: false })
const seg = (shape: SlideShape, ...vertices: number[]): SlideSegment => ({ shape, vertices })
const judge = (start: number, ...segments: SlideSegment[]) => SlideJudge.forSlide(start, slide(...segments))!

/** "B1+C" is a big hand, anything else a small one. */
const sizeOf = (spot: string): HandSize => (spot.includes('+') ? 'big' : 'small')
const press = (at: string): HandAction => ({ kind: 'press', size: sizeOf(at), at })
const tap = (at: string): HandAction => ({ kind: 'tap', size: sizeOf(at), at })
const to = (spot: string): HandAction => ({ kind: 'slide', size: sizeOf(spot), to: spot })
const release: HandAction = { kind: 'release' }

function play(start: number, segments: SlideSegment[], steps: (HandAction | null)[][]) {
  return runHands(judge(start, ...segments), steps)
}

describe('slide judge (1-5)', () => {
  const line = [seg('-', 5)]

  it('does not finish from B1 straight to A5', () => {
    expect(play(1, line, [[tap('B1')], [press('A5')]]).finished).toBe(false)
  })

  it('finishes B1, then B5, then A5 without letting go of B5', () => {
    const run = play(1, line, [[tap('B1')], [press('B5')], [null, press('A5')]])
    expect(run.finished).toBe(true)
    expect(run.touches).toBe(3)
    expect(run.finishedAtStep).toBe(2)
  })

  it('cannot reach B5 while B1 is still held', () => {
    expect(play(1, line, [[press('B1')], [null, press('B5')], [null, release], [null, press('A5')]]).finished).toBe(false)
  })

  it('does not count an early touch that was let go before its turn', () => {
    // B5 is touched and released before its turn; later the queue waits at C
    const run = play(1, line, [[tap('B5')], [tap('B1')], [press('A5')]])
    expect(run.finished).toBe(false)
  })

  it('lets a big hand cover B1 and C, then slide over to B5 and C', () => {
    const run = play(1, line, [[press('B1+C')], [to('B5+C')], [null, press('A5')]])
    expect(run.finished).toBe(true)
    expect(run.touches).toBe(2)
  })
})

describe('steps that must be touched', () => {

  it('1>2 needs A1', () => {
    expect(play(1, [seg('>', 2)], [[press('A2')]]).finished).toBe(false)
    expect(play(1, [seg('>', 2)], [[press('A1')], [null, press('A2')]]).finished).toBe(true)
  })

  it('1>3 needs A2', () => {
    expect(play(1, [seg('>', 3)], [[tap('A1')], [press('A3')]]).finished).toBe(false)
    expect(play(1, [seg('>', 3)], [[press('A2')], [null, press('A3')]]).finished).toBe(true)
  })

  it('1V75 needs A8/B8 and A6/B6 but not the corner A7', () => {
    expect(play(1, [seg('V', 7, 5)], [[tap('B8')], [press('B6')], [null, press('A5')]]).finished).toBe(true)
    expect(play(1, [seg('V', 7, 5)], [[tap('A8')], [press('A5')]]).finished).toBe(false)
  })
})

describe('connected slides', () => {
  it('1-3-5 can be followed with one sliding hand', () => {
    const run = play(1, [seg('-', 3), seg('-', 5)], [[press('A2')], [to('A3')], [to('B4')], [to('A5')]])
    expect(run.finished).toBe(true)
    expect(run.touches).toBe(1)
  })

  it('1-3-5 is not finished by its end alone', () => {
    expect(play(1, [seg('-', 3), seg('-', 5)], [[press('A5')]]).finished).toBe(false)
  })
})

describe('wifi', () => {
  it('needs all three lanes', () => {
    const j = judge(1, seg('w', 5))
    j.check(['A6', 'A5', 'A4'])
    expect(j.finished).toBe(false)
    j.check([])
    j.check(['B8', 'B1', 'B2'])
    j.check(['B7', 'C', 'B3'])
    j.check(['A6', 'A5', 'A4'])
    expect(j.finished).toBe(true)
  })
})

describe('hand rules', () => {
  it('stops at a move that cannot be made', () => {
    expect(play(1, [seg('-', 5)], [[press('B1')], [press('C')]]).error?.message).toContain('已经按着')
    expect(play(1, [seg('-', 5)], [[to('C')]]).error?.message).toContain('没有按着')
    expect(play(1, [seg('-', 5)], [[press('A1+A1')]]).error?.message).toContain('两个不同')
    expect(play(1, [seg('-', 5)], [[null, null, press('C')]]).error?.message).toContain('最多')
  })

  it('lets a hand change size from one move to the next', () => {
    // big over B1 and C, let go, then a small hand on B5 and another on A5
    const run = play(1, [seg('-', 5)], [[tap('B1+C')], [press('B5')], [null, press('A5')]])
    expect(run.finished).toBe(true)
    expect(run.frames.map((f) => f.hands[0]!.size)).toEqual(['big', 'big', 'small', 'small'])
  })

  it('lets a big hand cover any two sensors', () => {
    const run = play(1, [seg('-', 5)], [[press('B1+B5')], [null, press('A5')]])
    expect(run.frames[0]!.pressed.sort()).toEqual(['B1', 'B5'])
  })

  it('records a frame per step and a second one for a tap', () => {
    const run = play(1, [seg('-', 5)], [[tap('B1')], [press('C')]])
    expect(run.frames.map((f) => [f.step, f.pressed.join()])).toEqual([[0, 'B1'], [0, ''], [1, 'C']])
  })
})
