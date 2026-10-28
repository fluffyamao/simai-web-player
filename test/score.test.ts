import { expect, it } from 'vitest'
import { countScoreNotes, gradeLoss, noteKept, scoreAt, scoreObjects, scoreTimeline, totalBaseScore } from '../src/core/score'
import { parseSimai } from '../src/parser/simai'

const counts = (text: string) => countScoreNotes(parseSimai(text).notes)

it('counts what each note is worth', () => {
  expect(counts('(120)1,2h[4:1],C,')).toMatchObject({ tap: 1, hold: 1, touch: 1, slide: 0, break: 0 })
  expect(totalBaseScore(counts('(120)1,2h[4:1],C,'))).toBe(500 + 1000 + 500)
})

it('scores a slide as its star head plus the slide itself', () => {
  expect(counts('(120)1-5[4:1],')).toMatchObject({ tap: 1, slide: 1 })
  // one star, two slides
  expect(counts('(120)1-5[4:1]*-3[4:1],')).toMatchObject({ tap: 1, slide: 2 })
  // `?` drops the head
  expect(counts('(120)1?-5[4:1],')).toMatchObject({ tap: 0, slide: 1 })
})

it('counts a break as a break whatever it started as', () => {
  // a break hold is 2500, not 1000
  expect(counts('(120)1bh[4:1],')).toMatchObject({ hold: 0, break: 1 })
  expect(totalBaseScore(counts('(120)1bh[4:1],'))).toBe(2500)
  // the head and the slide break separately
  expect(counts('(120)1b-5[4:1],')).toMatchObject({ break: 1, slide: 1, tap: 0 })
  expect(counts('(120)1-5b[4:1],')).toMatchObject({ break: 1, slide: 0, tap: 1 })
})

it('leaves mines out', () => {
  expect(counts('(120)1m,2,')).toMatchObject({ tap: 1 })
})

it('keeps everything on a perfect and nothing on a miss', () => {
  expect(noteKept('tap', 'criticalPerfect')).toEqual({ base: 500, bonus: 0 })
  expect(noteKept('tap', 'perfect3')).toEqual({ base: 500, bonus: 0 })
  expect(noteKept('tap', 'great')).toEqual({ base: 400, bonus: 0 })
  expect(noteKept('tap', 'good')).toEqual({ base: 250, bonus: 0 })
  expect(noteKept('slide', 'miss')).toEqual({ base: 0, bonus: 0 })
})

it('only pays a break in full on a critical perfect', () => {
  expect(noteKept('break', 'criticalPerfect')).toEqual({ base: 2500, bonus: 100 })
  // a plain perfect already costs part of the bonus
  expect(noteKept('break', 'perfect2')).toEqual({ base: 2500, bonus: 75 })
  expect(noteKept('break', 'perfect3')).toEqual({ base: 2500, bonus: 50 })
  expect(noteKept('break', 'great')).toEqual({ base: 2000, bonus: 40 })
  expect(noteKept('break', 'good')).toEqual({ base: 1000, bonus: 30 })
})

it('works out what one note costs', () => {
  // 100 taps: 50000 base, no breaks
  const taps = { tap: 100, hold: 0, slide: 0, touch: 0, break: 0 }
  expect(gradeLoss(taps, 'tap', 'criticalPerfect')).toBe(0)
  // a great keeps 400 of 500, so 100 of 50000
  expect(gradeLoss(taps, 'tap', 'great')).toBeCloseTo(0.2, 10)
  expect(gradeLoss(taps, 'tap', 'good')).toBeCloseTo(0.5, 10)
  expect(gradeLoss(taps, 'tap', 'miss')).toBeCloseTo(1, 10)
})

it('splits the one percent break bonus between the breaks', () => {
  const chart = { tap: 90, hold: 0, slide: 0, touch: 0, break: 10 }
  // the bonus pool is 1% however many breaks share it
  const missed = gradeLoss(chart, 'break', 'miss')
  const base = (2500 / totalBaseScore(chart)) * 100
  expect(missed).toBeCloseTo(base + 0.1, 10)
  // a non-critical perfect costs only bonus, never base
  expect(gradeLoss(chart, 'break', 'perfect2')).toBeCloseTo(0.025, 10)
  expect(gradeLoss(chart, 'break', 'perfect3')).toBeCloseTo(0.05, 10)
  expect(gradeLoss(chart, 'break', 'criticalPerfect')).toBe(0)
})

it('adds up to 101 percent over a whole chart', () => {
  const chart = { tap: 40, hold: 5, slide: 10, touch: 5, break: 8 }
  const total = (['tap', 'hold', 'slide', 'touch', 'break'] as const).reduce(
    (sum, kind) => sum + chart[kind] * gradeLoss(chart, kind, 'miss'),
    0,
  )
  expect(total).toBeCloseTo(101, 8)
})

it('says nothing about an empty chart instead of dividing by zero', () => {
  const empty = { tap: 0, hold: 0, slide: 0, touch: 0, break: 0 }
  expect(totalBaseScore(empty)).toBe(0)
  expect(gradeLoss(empty, 'tap', 'miss')).toBe(0)
})

it('judges a hold at its tail and a slide at its end', () => {
  // 120bpm: a beat is 0.5s, so [4:1] is one beat
  const objects = scoreObjects(parseSimai('(120)1h[4:1],').notes)
  expect(objects).toEqual([{ ms: 500, kind: 'hold' }])
  // the star counts at once, the slide when it arrives
  expect(scoreObjects(parseSimai('(120)1-5[4:1],').notes)).toEqual([
    { ms: 0, kind: 'tap' },
    { ms: 1000, kind: 'slide' },
  ])
})

it('counts up as the chart goes by', () => {
  const t = scoreTimeline(parseSimai('(120)1,2,3,4,').notes)
  expect(t.times).toEqual([0, 500, 1000, 1500])
  expect(scoreAt(t, -1).combo).toBe(0)
  expect(scoreAt(t, 0).combo).toBe(1)
  expect(scoreAt(t, 999).combo).toBe(2)
  expect(scoreAt(t, 99999).combo).toBe(4)
  // a perfect run ends on 100% with no breaks to give the extra one
  expect(scoreAt(t, 99999).achievement).toBeCloseTo(100, 10)
  expect(scoreAt(t, 500).achievement).toBeCloseTo(50, 10)
})

it('reaches exactly 101 percent when the chart has breaks', () => {
  const t = scoreTimeline(parseSimai('(120)1b,2,3b,4,').notes)
  const end = scoreAt(t, 99999)
  expect(end.achievement).toBeCloseTo(101, 10)
  expect(end.achievement100).toBeCloseTo(101, 10)
  expect(end.achievement101).toBe(101)
  // halfway through the breaks the bonus is half paid
  expect(scoreAt(t, 0).achievement100).toBeCloseTo(100.5, 10)
})

it('holds 101 percent from the very start, since a perfect run loses nothing', () => {
  const t = scoreTimeline(parseSimai('(120)1b,2,3b,4,').notes)
  for (const ms of [-1, 0, 500, 1200, 99999]) expect(scoreAt(t, ms).achievement101).toBe(101)
  // without a break the pool cannot be paid at all
  expect(scoreAt(scoreTimeline(parseSimai('(120)1,2,').notes), 0).achievement101).toBe(100)
})

it('gives three DX points an object', () => {
  const t = scoreTimeline(parseSimai('(120)1,2,3-5[4:1],').notes)
  // three taps and one slide
  expect(t.times.length).toBe(4)
  expect(scoreAt(t, 99999)).toMatchObject({ dxScore: 12, dxTotal: 12 })
  expect(scoreAt(t, 0)).toMatchObject({ dxScore: 3, dxTotal: 12 })
})

it('says nothing on an empty chart instead of dividing by zero', () => {
  const t = scoreTimeline([])
  expect(scoreAt(t, 0)).toMatchObject({ combo: 0, total: 0, achievement: 0, dxTotal: 0 })
})

it('shifts the timeline by the chart offset', () => {
  const notes = parseSimai('(120)1,2,').notes
  expect(scoreTimeline(notes, 1.5).times).toEqual([1500, 2000])
})
