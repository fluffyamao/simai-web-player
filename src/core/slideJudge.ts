// SPDX-License-Identifier: GPL-3.0-only
//
// Slide judge queues, ported from MajdataPlay (GPL-3.0):
//   Scenes/Game/Utils/SlideTables.cs           the queues of every shape, starting at button 1
//   Scenes/Game/NoteLoader.cs                  DetectShapeFromText, connected slide queue length
//   Scenes/Game/NoteBehaviours/SlideDrop.cs    mirroring, rotation, connected slide skip rules
//   IO/Base/Extensions/SensorAreaExtensions.cs Mirror / Diff of sensor names
//
// A slide is judged by walking its queue: each step is one sensor, or two of which either
// counts. Steps marked not skippable must be touched; the last step completes the slide.
import type { SlideSegment, SlidePath } from '../parser/types'

export interface JudgeStep {
  /** Sensors of this step ("A2", "C" ...); touching any one of them counts. */
  sensors: string[]
  /** May be passed over when the step after it is touched. */
  skippable: boolean
  /** Completes the slide once touched. */
  last: boolean
  /** Arrow progress when the step is touched and when it is finished, as in MajdataPlay. */
  progressOn: number
  progressFinished: number
}

/** [sensors joined by |, progress when on, when finished, skippable, last] */
type Row = [string, number, number, number, number]

const TABLES: Record<string, { queue: Row[]; const: number }> = {
  circle2: { queue: [['A1', 0, 3, 0, 0], ['A2', 5, 7, 1, 1]], const: 0.465 },
  circle3: { queue: [['A1', 0, 3, 1, 0], ['A2', 7, 11, 0, 0], ['A3', 13, 15, 1, 1]], const: 0.233 },
  circle4: { queue: [['A1', 0, 3, 1, 0], ['A2', 7, 11, 1, 0], ['A3', 14, 19, 1, 0], ['A4', 21, 23, 1, 1]], const: 0.155 },
  circle5: { queue: [['A1', 0, 3, 1, 0], ['A2', 7, 11, 1, 0], ['A3', 14, 19, 1, 0], ['A4', 23, 27, 1, 0], ['A5', 29, 31, 1, 1]], const: 0.116 },
  circle6: { queue: [['A1', 0, 3, 1, 0], ['A2', 7, 11, 1, 0], ['A3', 14, 19, 1, 0], ['A4', 23, 27, 1, 0], ['A5', 31, 35, 1, 0], ['A6', 37, 39, 1, 1]], const: 0.093 },
  circle7: { queue: [['A1', 0, 3, 1, 0], ['A2', 7, 11, 1, 0], ['A3', 14, 19, 1, 0], ['A4', 23, 27, 1, 0], ['A5', 31, 35, 1, 0], ['A6', 39, 43, 1, 0], ['A7', 45, 47, 1, 1]], const: 0.078 },
  circle8: { queue: [['A1', 0, 3, 1, 0], ['A2', 7, 11, 1, 0], ['A3', 14, 19, 1, 0], ['A4', 23, 27, 1, 0], ['A5', 31, 35, 1, 0], ['A6', 39, 43, 1, 0], ['A7', 46, 51, 1, 0], ['A8', 53, 55, 1, 1]], const: 0.066 },
  circle1: { queue: [['A1', 0, 3, 1, 0], ['A2', 7, 11, 1, 0], ['A3', 14, 19, 1, 0], ['A4', 23, 27, 1, 0], ['A5', 31, 35, 1, 0], ['A6', 39, 43, 1, 0], ['A7', 46, 51, 1, 0], ['A8', 54, 59, 1, 0], ['A1', 61, 63, 1, 1]], const: 0.058 },
  line3: { queue: [['A1', 0, 3, 1, 0], ['A2|B2', 6, 9, 0, 0], ['A3', 10, 13, 1, 1]], const: 0.182 },
  line4: { queue: [['A1', 0, 4, 1, 0], ['B2', 6, 9, 1, 0], ['B3', 11, 14, 1, 0], ['A4', 15, 18, 1, 1]], const: 0.19 },
  line5: { queue: [['A1', 0, 4, 1, 0], ['B1', 5, 7, 1, 0], ['C', 10, 12, 1, 0], ['B5', 13, 16, 1, 0], ['A5', 17, 19, 1, 1]], const: 0.152 },
  line6: { queue: [['A1', 0, 4, 1, 0], ['B8', 6, 9, 1, 0], ['B7', 11, 14, 1, 0], ['A6', 15, 18, 1, 1]], const: 0.19 },
  line7: { queue: [['A1', 0, 3, 1, 0], ['A8|B8', 6, 9, 0, 0], ['A7', 10, 13, 1, 1]], const: 0.182 },
  v1: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 8, 13, 1, 0], ['B1', 14, 16, 1, 0], ['A1', 17, 19, 1, 1]], const: 0.185 },
  v2: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 8, 13, 1, 0], ['B2', 14, 16, 1, 0], ['A2', 17, 19, 1, 1]], const: 0.15 },
  v3: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 8, 13, 1, 0], ['B3', 14, 16, 1, 0], ['A3', 17, 19, 1, 1]], const: 0.158 },
  v4: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 8, 13, 1, 0], ['B4', 14, 16, 1, 0], ['A4', 17, 19, 1, 1]], const: 0.158 },
  v6: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 8, 13, 1, 0], ['B6', 14, 16, 1, 0], ['A6', 17, 19, 1, 1]], const: 0.158 },
  v7: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 8, 13, 1, 0], ['B7', 14, 16, 1, 0], ['A7', 17, 19, 1, 1]], const: 0.158 },
  v8: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 8, 13, 1, 0], ['B8', 14, 16, 1, 0], ['A8', 17, 19, 1, 1]], const: 0.154 },
  ppqq1: { queue: [['A1', 0, 3, 1, 0], ['B1', 5, 7, 1, 0], ['C', 10, 13, 1, 0], ['B4', 15, 17, 1, 0], ['A3', 21, 26, 1, 0], ['A2', 29, 32, 1, 0], ['A1', 33, 35, 1, 1]], const: 0.065 },
  ppqq2: { queue: [['A1', 0, 3, 1, 0], ['B1', 5, 7, 1, 0], ['C', 9, 13, 1, 0], ['B4', 14, 17, 1, 0], ['A3', 20, 25, 1, 0], ['A2', 26, 28, 1, 1]], const: 0.086 },
  ppqq3: { queue: [['A1', 0, 3, 1, 0], ['B1', 4, 7, 1, 0], ['C', 9, 13, 1, 0], ['B4', 14, 17, 1, 0], ['A3', 19, 22, 1, 1]], const: 0.157 },
  ppqq4: { queue: [['A1', 0, 3, 1, 0], ['B1', 5, 7, 1, 0], ['C', 9, 13, 1, 0], ['B4', 14, 17, 1, 0], ['A3', 20, 25, 1, 0], ['A2', 28, 33, 1, 0], ['B1', 34, 37, 1, 0], ['C', 39, 43, 1, 0], ['B4', 44, 46, 1, 0], ['A4', 47, 49, 1, 1]], const: 0.065 },
  ppqq5: { queue: [['A1', 0, 3, 1, 0], ['B1', 5, 7, 1, 0], ['C', 9, 13, 1, 0], ['B4', 14, 17, 1, 0], ['A3', 20, 25, 1, 0], ['A2', 28, 33, 1, 0], ['B1', 34, 37, 1, 0], ['C', 39, 43, 1, 0], ['B5', 44, 46, 1, 0], ['A5', 47, 49, 1, 1]], const: 0.065 },
  ppqq6: { queue: [['A1', 0, 3, 1, 0], ['B1', 5, 7, 1, 0], ['C', 9, 13, 1, 0], ['B4', 14, 17, 1, 0], ['A3', 20, 25, 1, 0], ['A2', 28, 33, 1, 0], ['B1', 34, 37, 1, 0], ['C|B8', 38, 40, 1, 0], ['B7|B6', 42, 44, 1, 0], ['A6', 46, 48, 1, 1]], const: 0.067 },
  ppqq7: { queue: [['A1', 0, 3, 1, 0], ['B1', 5, 7, 1, 0], ['C', 9, 13, 1, 0], ['B4', 14, 17, 1, 0], ['A3', 20, 25, 1, 0], ['A2', 28, 33, 1, 0], ['B1', 34, 37, 1, 0], ['B8', 38, 42, 1, 0], ['A7', 43, 46, 1, 1]], const: 0.079 },
  ppqq8: { queue: [['A1', 0, 3, 1, 0], ['B1', 5, 7, 1, 0], ['C', 9, 13, 1, 0], ['B4', 14, 17, 1, 0], ['A3', 20, 25, 1, 0], ['A2', 28, 33, 1, 0], ['B1|A1', 35, 37, 1, 0], ['A8', 38, 41, 1, 1]], const: 0.0626 },
  L2: { queue: [['A1', 0, 3, 1, 0], ['B8|A8', 6, 10, 0, 0], ['A7', 12, 19, 1, 0], ['B8', 21, 24, 1, 0], ['B1', 25, 28, 1, 0], ['A2', 29, 32, 1, 1]], const: 0.1 },
  L3: { queue: [['A1', 0, 3, 1, 0], ['B8|A8', 6, 10, 0, 0], ['A7', 12, 18, 1, 0], ['B7', 20, 22, 1, 0], ['C', 25, 27, 1, 0], ['B3', 28, 31, 1, 0], ['A3', 32, 34, 1, 1]], const: 0.104 },
  L4: { queue: [['A1', 0, 3, 1, 0], ['B8|A8', 6, 10, 0, 0], ['A7', 12, 19, 1, 0], ['B6', 21, 24, 1, 0], ['B5', 25, 28, 1, 0], ['A4', 29, 32, 1, 1]], const: 0.098 },
  L5: { queue: [['A1', 0, 3, 1, 0], ['B8|A8', 6, 10, 0, 0], ['A7', 12, 18, 1, 0], ['B6|A6', 21, 24, 0, 0], ['A5', 27, 28, 1, 1]], const: 0.105 },
  s: { queue: [['A1', 0, 4, 1, 0], ['B8', 7, 9, 1, 0], ['B7', 10, 12, 1, 0], ['C', 14, 17, 1, 0], ['B3', 19, 21, 1, 0], ['B4', 22, 25, 1, 0], ['A5', 27, 30, 1, 1]], const: 0.13 },
  pq1: { queue: [['A1', 0, 4, 1, 0], ['B8', 5, 8, 1, 0], ['B7', 9, 11, 1, 0], ['B6', 12, 14, 1, 0], ['B5', 15, 17, 1, 0], ['B4', 19, 21, 1, 0], ['B3', 22, 24, 1, 0], ['B2', 25, 29, 1, 0], ['A1', 30, 33, 1, 1]], const: 0.095 },
  pq2: { queue: [['A1', 0, 4, 1, 0], ['B8', 5, 8, 1, 0], ['B7', 9, 11, 1, 0], ['B6', 12, 14, 1, 0], ['B5', 16, 18, 1, 0], ['B4', 19, 21, 1, 0], ['B3', 22, 26, 1, 0], ['A2', 27, 30, 1, 1]], const: 0.112 },
  pq3: { queue: [['A1', 0, 4, 1, 0], ['B8', 5, 8, 1, 0], ['B7', 9, 11, 1, 0], ['B6', 12, 14, 1, 0], ['B5', 16, 18, 1, 0], ['B4', 20, 23, 1, 0], ['A3', 25, 27, 1, 1]], const: 0.125 },
  pq4: { queue: [['A1', 0, 4, 1, 0], ['B8', 5, 8, 1, 0], ['B7', 9, 11, 1, 0], ['B6', 12, 14, 1, 0], ['B5', 16, 20, 1, 0], ['A4', 22, 24, 1, 1]], const: 0.139 },
  pq5: { queue: [['A1', 0, 4, 1, 0], ['B8', 5, 8, 1, 0], ['B7', 9, 12, 1, 0], ['B6', 14, 17, 1, 0], ['A5', 19, 21, 1, 1]], const: 0.160 },
  pq6: { queue: [['A1', 0, 4, 1, 0], ['B8', 5, 8, 1, 0], ['B7', 9, 11, 1, 0], ['B6', 13, 15, 1, 0], ['B5', 16, 18, 1, 0], ['B4', 19, 21, 1, 0], ['B3', 22, 24, 1, 0], ['B2', 25, 27, 1, 0], ['B1', 28, 30, 1, 0], ['B8', 31, 33, 1, 0], ['B7', 35, 38, 1, 0], ['A6', 40, 42, 1, 1]], const: 0.080 },
  pq7: { queue: [['A1', 0, 4, 1, 0], ['B8', 7, 9, 1, 0], ['B7', 10, 12, 1, 0], ['B6', 13, 15, 1, 0], ['B5', 16, 18, 1, 0], ['B4', 20, 22, 1, 0], ['B3', 23, 25, 1, 0], ['B2', 26, 28, 1, 0], ['B1', 30, 32, 1, 0], ['B8', 33, 36, 1, 0], ['A7', 37, 40, 1, 1]], const: 0.084 },
  pq8: { queue: [['A1', 0, 4, 1, 0], ['B8', 5, 8, 1, 0], ['B7', 9, 11, 1, 0], ['B6', 12, 14, 1, 0], ['B5', 15, 17, 1, 0], ['B4', 19, 21, 1, 0], ['B3', 22, 24, 1, 0], ['B2', 25, 27, 1, 0], ['B1', 28, 32, 1, 0], ['A8', 33, 36, 1, 1]], const: 0.0895 },
}

/** Wifi lanes in MajdataPlay's order: Left, Center, Right (modern judge). */
const WIFI: Row[][] = [
[['A1', 0, 0, 1, 0], ['B8', 2, 2, 1, 0], ['B7', 4, 4, 1, 0], ['A6|D6', 7, 7, 1, 1]],
[['A1', 0, 0, 1, 0], ['B1', 2, 2, 1, 0], ['C', 4, 4, 1, 0], ['A5|B5', 7, 7, 1, 1]],
[['A1', 0, 0, 1, 0], ['B2', 2, 2, 1, 0], ['B3', 4, 4, 1, 0], ['A4|D5', 7, 7, 1, 1]]
]

export const WIFI_CONST = 0.162870

const wrap8 = (n: number) => ((((n - 1) % 8) + 8) % 8) + 1
const isUpperHalf = (b: number) => b === 7 || b === 8 || b === 1 || b === 2
/** End position relative to the start, 1..8 (1 = the start itself). */
const relative = (start: number, end: number) => wrap8(end - start + 1)
/** NoteCreateHelper.MirrorKeys: reflect a relative position across the start. */
const mirrorKey = (k: number) => wrap8(2 - k)

/**
 * The table a segment uses, as NoteLoader.DetectShapeFromText names it; a leading "-" means
 * the table is mirrored. Null for a shape the game rejects.
 */
export function tableName(start: number, seg: SlideSegment): string | null {
  const v = seg.vertices
  const end = relative(start, v[v.length - 1]!)
  switch (seg.shape) {
    case '-':
      return end >= 3 && end <= 7 ? `line${end}` : null
    case '>':
      return isUpperHalf(start) ? `circle${end}` : `-circle${mirrorKey(end)}`
    case '<':
      return !isUpperHalf(start) ? `circle${end}` : `-circle${mirrorKey(end)}`
    case '^':
      if (end === 1 || end === 5) return null
      return end < 5 ? `circle${end}` : `-circle${mirrorKey(end)}`
    case 'v':
      return end === 5 ? null : `v${end}`
    case 'pp':
      return `ppqq${end}`
    case 'qq':
      return `-ppqq${mirrorKey(end)}`
    case 'p':
      return `pq${end}`
    case 'q':
      return `-pq${mirrorKey(end)}`
    case 's':
      return end === 5 ? 's' : null
    case 'z':
      return end === 5 ? '-s' : null
    case 'V': {
      if (v.length < 2) return null
      const turn = relative(start, v[0]!)
      if (turn === 7) return end >= 2 && end <= 5 ? `L${end}` : null
      if (turn === 3) return end >= 5 ? `-L${mirrorKey(end)}` : null
      return null
    }
    case 'w':
      return end === 5 ? 'wifi' : null
  }
  return null
}

/** Move a sensor name round by `diff` steps clockwise (SensorAreaExtensions.Diff). */
function diffSensor(name: string, diff: number): string {
  if (name === 'C') return name
  return name[0]! + wrap8(Number(name.slice(1)) + diff)
}

/** Reflect a sensor name across the axis through A1 (SensorAreaExtensions.Mirror, A/B/C only). */
function mirrorSensor(name: string): string {
  if (name === 'C') return name
  return name[0]! + wrap8(2 - Number(name.slice(1)))
}

function build(rows: Row[], start: number, mirror: boolean): JudgeStep[] {
  return rows.map(([names, on, fin, skip, last]) => ({
    sensors: names.split('|').map((n) => diffSensor(mirror ? mirrorSensor(n) : n, start - 1)),
    skippable: skip === 1,
    last: last === 1,
    progressOn: on,
    progressFinished: fin,
  }))
}

/** Judge queues of one segment starting at `start`: one lane, or three for wifi. Null if invalid. */
export function segmentQueues(start: number, seg: SlideSegment): JudgeStep[][] | null {
  const name = tableName(start, seg)
  if (!name) return null
  if (name === 'wifi') return WIFI.map((lane) => build(lane, start, false))
  const mirror = name.startsWith('-')
  const table = TABLES[mirror ? name.slice(1) : name]
  return table ? [build(table.queue, start, mirror)] : null
}

/**
 * The judge queues of a whole slide, one entry per segment (each holding one lane, or three
 * for wifi), with the connected slide rules of SlideDrop.InitializeSlideGroup and
 * UpdateJudgeQueue applied. Null if any segment is invalid.
 */
export function slideQueues(start: number, slide: SlidePath): JudgeStep[][][] | null {
  const parts: JudgeStep[][][] = []
  let from = start
  for (const seg of slide.segments) {
    const q = segmentQueues(from, seg)
    if (!q) return null
    parts.push(q)
    from = seg.vertices[seg.vertices.length - 1]!
  }
  if (parts.length > 1) {
    // NoteLoader: an inner part shares its last step with the next part
    const total = parts.reduce((s, p, i) => s + p[0]!.length - (i < parts.length - 1 ? 1 : 0), 0)
    parts.forEach((lanes, i) => {
      const head = i === 0
      const end = i === parts.length - 1
      for (const q of lanes) {
        if (!end) q[q.length - 1]!.last = false
        if (total >= 4) for (const step of q) step.skippable = true
        else if (head && q.length >= 2) {
          q[0]!.skippable = true
          q[1]!.skippable = false
        } else if (end && q.length >= 2) {
          q[0]!.skippable = false
          q[1]!.skippable = true
        }
      }
    })
  }
  return parts
}
