// SPDX-License-Identifier: GPL-3.0-only
import type { Note } from '../parser/types'

/**
 * How maimai DX scores a chart, following MajdataPlay's ObjectCounter.
 *
 * Achievement is two pools added together:
 *   base   = the score kept / the score of every note hit perfectly   (up to 100%)
 *   bonus  = the break bonus kept / (breaks * 100)                    (up to 1%)
 * so a perfect play is 101%.
 */

/** What a scoring object is worth. A slide is two objects: its star head and the slide itself. */
export type ScoreKind = 'tap' | 'hold' | 'slide' | 'touch' | 'break'

export const BASE_SCORE: Record<ScoreKind, number> = {
  tap: 500,
  touch: 500,
  hold: 1000,
  slide: 1500,
  break: 2500,
}

/** The break bonus pool each break carries, on top of its base score. */
export const BREAK_BONUS = 100

/**
 * A note's grade. The three perfects and the three greats differ only for breaks;
 * every other note scores the same across them.
 */
export type Grade = 'criticalPerfect' | 'perfect2' | 'perfect3' | 'great' | 'great2' | 'great3' | 'good' | 'miss'

export const GRADES: Grade[] = ['criticalPerfect', 'perfect2', 'perfect3', 'great', 'great2', 'great3', 'good', 'miss']

/** What a break keeps at each grade: only a critical perfect keeps everything. */
const BREAK_KEPT: Record<Grade, { base: number; bonus: number }> = {
  criticalPerfect: { base: 2500, bonus: 100 },
  perfect2: { base: 2500, bonus: 75 },
  perfect3: { base: 2500, bonus: 50 },
  great: { base: 2000, bonus: 40 },
  great2: { base: 1500, bonus: 40 },
  great3: { base: 1250, bonus: 40 },
  good: { base: 1000, bonus: 30 },
  miss: { base: 0, bonus: 0 },
}

/** The share of its base score every other note keeps. */
const KEPT: Record<Grade, number> = {
  criticalPerfect: 1,
  perfect2: 1,
  perfect3: 1,
  great: 0.8,
  great2: 0.8,
  great3: 0.8,
  good: 0.5,
  miss: 0,
}

export type ScoreCounts = Record<ScoreKind, number>

/**
 * Count a chart's scoring objects.
 *
 * A break is 2500 whatever it started as, so a break hold counts as a break and not
 * as a hold. A slide contributes its star head (unless it is headless) and one object
 * per slide path, each of which can be a break on its own. Mines do not score.
 */
export interface ScoreObject {
  /** When it is judged, in milliseconds of chart time. */
  ms: number
  kind: ScoreKind
}

/**
 * Every scoring object in a chart, in the order it is judged: a hold counts at its
 * tail and a slide when it reaches its end, which is when the arcade awards them.
 */
export function scoreObjects(notes: Note[]): ScoreObject[] {
  const out: ScoreObject[] = []
  for (const note of notes) {
    if (note.isMine) continue
    if (note.slides.length) {
      if (note.head !== 'none') out.push({ ms: note.time * 1000, kind: note.isBreak ? 'break' : 'tap' })
      for (const slide of note.slides) {
        out.push({ ms: (note.time + slide.delay + slide.duration) * 1000, kind: slide.isBreak ? 'break' : 'slide' })
      }
    } else if (note.kind === 'hold' || note.kind === 'touchHold') {
      out.push({ ms: (note.time + note.length) * 1000, kind: note.isBreak ? 'break' : 'hold' })
    } else {
      out.push({ ms: note.time * 1000, kind: note.isBreak ? 'break' : note.kind === 'touch' ? 'touch' : 'tap' })
    }
  }
  return out.sort((a, b) => a.ms - b.ms)
}

export function countScoreNotes(notes: Note[]): ScoreCounts {
  const counts: ScoreCounts = { tap: 0, hold: 0, slide: 0, touch: 0, break: 0 }
  for (const object of scoreObjects(notes)) counts[object.kind]++
  return counts
}

/** The score of a chart played perfectly, before the break bonus. */
export function totalBaseScore(counts: ScoreCounts): number {
  let total = 0
  for (const kind of Object.keys(counts) as ScoreKind[]) total += counts[kind] * BASE_SCORE[kind]
  return total
}

/** The base score and break bonus one note keeps at this grade. */
export function noteKept(kind: ScoreKind, grade: Grade): { base: number; bonus: number } {
  if (kind === 'break') return BREAK_KEPT[grade]
  return { base: BASE_SCORE[kind] * KEPT[grade], bonus: 0 }
}

/**
 * The achievement one note of this kind costs at this grade, as a percentage of the
 * whole chart. Returns 0 for a chart with nothing in it.
 */
export function gradeLoss(counts: ScoreCounts, kind: ScoreKind, grade: Grade): number {
  const total = totalBaseScore(counts)
  if (!total) return 0
  const kept = noteKept(kind, grade)
  const base = ((BASE_SCORE[kind] - kept.base) / total) * 100
  // only breaks draw on the bonus pool, which is 1% however many of them share it
  const bonus = kind === 'break' && counts.break ? (BREAK_BONUS - kept.bonus) / (counts.break * BREAK_BONUS) : 0
  return base + bonus
}

/** One frame of the arcade's 60fps clock, which every judgement window is counted in. */
export const FRAME_MS = 1000 / 60

/**
 * How far off a note may be hit, in frames, for each grade. The value is the outer
 * edge: a tap is a critical perfect within 1 frame either way. Anything past `good`
 * is a miss. Touches are judged far more loosely than everything else.
 */
export const JUDGE_FRAMES: Record<'tap' | 'touch', Record<Exclude<Grade, 'miss'>, number>> = {
  tap: { criticalPerfect: 1, perfect2: 2, perfect3: 3, great: 4, great2: 5, great3: 6, good: 9 },
  touch: { criticalPerfect: 9, perfect2: 10.5, perfect3: 12, great: 13, great2: 14, great3: 15, good: 18 },
}

/**
 * A chart's scoring objects with running totals, so the score at any moment is a
 * lookup rather than a walk over every note.
 */
export interface ScoreTimeline {
  /** Judge time of each object, ascending. */
  times: number[]
  /** Base score of everything judged up to and including each index. */
  base: number[]
  /** Breaks judged up to and including each index. */
  breaks: number[]
  counts: ScoreCounts
  totalBase: number
}

/** `offsetSec` is the chart's `&first`, so the times line up with playback. */
export function scoreTimeline(notes: Note[], offsetSec = 0): ScoreTimeline {
  const objects = scoreObjects(notes)
  const times: number[] = []
  const base: number[] = []
  const breaks: number[] = []
  const counts: ScoreCounts = { tap: 0, hold: 0, slide: 0, touch: 0, break: 0 }
  let runningBase = 0
  let runningBreaks = 0
  for (const object of objects) {
    counts[object.kind]++
    runningBase += BASE_SCORE[object.kind]
    if (object.kind === 'break') runningBreaks++
    times.push(object.ms + offsetSec * 1000)
    base.push(runningBase)
    breaks.push(runningBreaks)
  }
  return { times, base, breaks, counts, totalBase: runningBase }
}

/**
 * What a run that hit everything perfectly would read at this moment.
 *
 * Nothing here is judged against a player, so this is the arcade's counters for a
 * flawless play: it says how much of the chart's score is already behind you.
 */
export interface ScoreState {
  /** Objects judged so far, and the chart's total. */
  combo: number
  total: number
  /** Counted up from zero, reaching 101% at the end. */
  achievement: number
  /** From 100%: the base is taken as kept, so only the break bonus comes in. */
  achievement100: number
  /** From 101%: nothing is ever lost on a perfect run, so this does not move. */
  achievement101: number
  dxScore: number
  dxTotal: number
}

/** Each object is worth three DX points, all of which a critical perfect keeps. */
export const DX_PER_NOTE = 3

export function scoreAt(timeline: ScoreTimeline, ms: number): ScoreState {
  const { times, counts, totalBase } = timeline
  // how many objects have been judged by now
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= ms) lo = mid + 1
    else hi = mid
  }
  const judged = lo
  const base = judged ? timeline.base[judged - 1]! : 0
  const breaks = judged ? timeline.breaks[judged - 1]! : 0
  // the bonus pool is one percent, shared out as the breaks go by
  const bonus = counts.break ? breaks / counts.break : 0
  const full = counts.break ? 1 : 0
  return {
    combo: judged,
    total: times.length,
    achievement: totalBase ? (base / totalBase) * 100 + bonus : 0,
    achievement100: 100 + bonus,
    achievement101: 100 + full,
    dxScore: judged * DX_PER_NOTE,
    dxTotal: times.length * DX_PER_NOTE,
  }
}
