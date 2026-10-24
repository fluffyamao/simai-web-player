// SPDX-License-Identifier: GPL-3.0-only
//
// Slide timing and geometry for drawing. Timing follows MajdataPlay (GPL-3.0):
//   NoteBehaviours/ExtendSlideDrop.cs   track fade-in
//   NoteBehaviours/SingleSlideBase.cs   star fade-in and motion
//   NoteBehaviours/WifiDrop.cs          wifi stars
// Connected slides split their time by arrow count, as in MajRadar's SlidePathResolver.
import { buttonPoint, JUDGE_RADIUS, type Vec2 } from '../core/geometry'
import { ARROW_DISTANCE, buildArrows, pathFromSlideCode, type Arrow } from '../core/slidePath'
import { slideQueues } from '../core/slideJudge'
import { slideCode, wrapButton } from '../core/slideShapes'
import type { Note, SlidePath } from '../parser/types'

export interface PathPart {
  kind: 'path'
  /** Arrow points including the path's start and end (no arrow drawn there). */
  arrows: Arrow[]
  /** Index range of arrows that are drawn: [first, last). */
  first: number
  last: number
  /** Share of the slide's time, as fractions 0..1. */
  t0: number
  t1: number
}

export interface WifiPart {
  kind: 'wifi'
  start: Vec2
  /** Right, centre and left end points. */
  ends: [Vec2, Vec2, Vec2]
  t0: number
  t1: number
}

export type SlidePart = PathPart | WifiPart

/** A step of the slide's judge queue, placed in time for drawing. */
export interface JudgeMark {
  sensors: string[]
  skippable: boolean
  last: boolean
  /** Number shown on the step, counting along the slide (wifi lanes count side by side). */
  order: number
  /** Fraction 0..1 of the slide's time at which the star has passed the step. */
  at: number
}

export interface PreparedSlide {
  note: Note
  slide: SlidePath
  /** Audio time of the star tap. */
  tapTime: number
  /** Audio time the star starts to move. */
  startTime: number
  endTime: number
  isEach: boolean
  parts: SlidePart[]
  /** Judge queue steps; empty when the game would reject the slide. */
  judge: JudgeMark[]
}

/** Bars in a wifi slide; also its weight when chained (MajRadar counts 12). */
const WIFI_BARS = 12

function buildPart(start: number, seg: SlidePath['segments'][number]): SlidePart | null {
  const end = seg.vertices[seg.vertices.length - 1]!
  if (seg.shape === 'w') {
    return {
      kind: 'wifi',
      start: buttonPoint(start, JUDGE_RADIUS),
      ends: [
        buttonPoint(wrapButton(end - 1), JUDGE_RADIUS),
        buttonPoint(end, JUDGE_RADIUS),
        buttonPoint(wrapButton(end + 1), JUDGE_RADIUS),
      ],
      t0: 0,
      t1: 0,
    }
  }
  const code = slideCode(start, seg)
  if (!code) return null
  try {
    const arrows = buildArrows(pathFromSlideCode(code))
    return { kind: 'path', arrows, first: 1, last: arrows.length - 1, t0: 0, t1: 0 }
  } catch {
    return null
  }
}

const weight = (p: SlidePart) => (p.kind === 'wifi' ? WIFI_BARS : Math.max(1, p.arrows.length - 2))

export function prepareSlides(notes: { note: Note; time: number }[]): PreparedSlide[] {
  const result: PreparedSlide[] = []
  const perTime = new Map<number, number>()
  for (const { note, time } of notes) {
    if (note.slides.length === 0) continue
    const key = Math.round(time * 1e6)
    perTime.set(key, (perTime.get(key) ?? 0) + note.slides.length)
  }

  for (const { note, time } of notes) {
    if (note.location.group !== 'button') continue
    for (const slide of note.slides) {
      const parts: SlidePart[] = []
      let from = note.location.index
      let ok = true
      for (const seg of slide.segments) {
        const part = buildPart(from, seg)
        if (!part) {
          ok = false
          break
        }
        parts.push(part)
        from = seg.vertices[seg.vertices.length - 1]!
      }
      if (!ok || parts.length === 0) continue

      // split time by arrow count, and in a chain keep the short last arrow of inner parts
      const total = parts.reduce((s, p) => s + weight(p), 0)
      let acc = 0
      parts.forEach((p, i) => {
        p.t0 = acc / total
        acc += weight(p)
        p.t1 = acc / total
        if (p.kind === 'path' && i === parts.length - 1) {
          const a = p.arrows
          if (a.length >= 3 && a[a.length - 1]!.at - a[a.length - 2]!.at <= ARROW_DISTANCE / 2) p.last--
        }
      })

      const judge: JudgeMark[] = []
      const queues = slideQueues(note.location.index, slide)
      let order = 0
      queues?.forEach((lanes, i) => {
        const part = parts[i]!
        let longest = 0
        for (const lane of lanes) {
          const max = Math.max(1, lane[lane.length - 1]!.progressFinished)
          lane.forEach((step, k) => {
            judge.push({
              sensors: step.sensors,
              skippable: step.skippable,
              last: step.last,
              order: order + k + 1,
              at: part.t0 + (part.t1 - part.t0) * (step.progressFinished / max),
            })
          })
          longest = Math.max(longest, lane.length)
        }
        order += longest
      })

      const startTime = time + slide.delay
      result.push({
        note,
        slide,
        tapTime: time,
        startTime,
        endTime: startTime + slide.duration,
        isEach: (perTime.get(Math.round(time * 1e6)) ?? 0) >= 2,
        parts,
        judge,
      })
    }
  }
  return result
}

/** Track opacity: fades to 0.5 a little before the star tap, full just before it. */
export function trackAlpha(s: PreparedSlide, now: number, speed: number): number {
  const fadeIn = s.tapTime - 3.926913 / speed
  const complete = s.tapTime - 0.05
  if (now < fadeIn) return 0
  if (now > complete) return 1
  const duration = Math.min(Math.max(complete - fadeIn, 0), 0.2)
  const cutoff = fadeIn + duration
  if (now > cutoff || duration === 0) return 0.5
  return (1 - (cutoff - now) / duration) * 0.5
}

/** Progress of the star along the whole slide, 0..1. */
export function slideProgress(s: PreparedSlide, now: number): number {
  const length = s.endTime - s.startTime
  if (length <= 0) return now >= s.startTime ? 1 : 0
  return Math.min(Math.max((now - s.startTime) / length, 0), 1)
}

/** Position and heading of a star `local` (0..1) of the way through a path part. */
export function starOnPath(part: PathPart, local: number): { point: Vec2; angle: number } {
  const a = part.arrows
  const f = (a.length - 1) * local
  const i = Math.min(Math.floor(f), a.length - 2)
  const u = f - i
  const p = a[i]!.point
  const q = a[i + 1]!.point
  const d1 = a[i]!.direction
  const d2 = a[i + 1]!.direction
  return {
    point: { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u },
    angle: Math.atan2(d1.y + (d2.y - d1.y) * u, d1.x + (d2.x - d1.x) * u),
  }
}

/**
 * The track of a slide starting at button `start`, as polylines in world units: one per path
 * segment, three (right, centre, left) for wifi. Null if a segment cannot be drawn.
 */
export function slideTrack(start: number, slide: SlidePath): Vec2[][] | null {
  const lines: Vec2[][] = []
  let from = start
  for (const seg of slide.segments) {
    const part = buildPart(from, seg)
    if (!part) return null
    if (part.kind === 'wifi') for (const end of part.ends) lines.push([part.start, end])
    else lines.push(part.arrows.map((a) => a.point))
    from = seg.vertices[seg.vertices.length - 1]!
  }
  return lines
}
