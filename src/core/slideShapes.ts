// SPDX-License-Identifier: GPL-3.0-only
//
// Standard simai slide shapes expressed as MajdataPlay slide codes (see slidePath.ts).
// MajdataPlay draws standard slides from Unity prefabs; the directions and loop circles
// here were matched against those prefabs (Assets/Prefabs/Game/Slides/*.prefab) and
// against the arrow counts in MajRadar's StandardSlideBarCounts (GPL-3.0).
import type { SlideSegment } from '../parser/types'

/** Wrap a button number into 1..8. */
export const wrapButton = (n: number) => ((((n - 1) % 8) + 8) % 8) + 1

const isUpperHalf = (b: number) => b === 7 || b === 8 || b === 1 || b === 2

/** Steps clockwise from a to b, 0..7. */
const stepsCw = (a: number, b: number) => (((b - a) % 8) + 8) % 8

/**
 * Slide code for one segment starting at `start`, or null for wifi (drawn separately)
 * and shapes that are not valid.
 */
export function slideCode(start: number, seg: SlideSegment): string | null {
  const end = seg.vertices[seg.vertices.length - 1]!
  const rel = stepsCw(start, end)
  switch (seg.shape) {
    case '-':
      return rel >= 2 && rel <= 6 ? `${start}K${end}` : null
    case '>':
      return `${start}${isUpperHalf(start) ? 'Q' : 'P'}9K${end}`
    case '<':
      return `${start}${isUpperHalf(start) ? 'P' : 'Q'}9K${end}`
    case '^':
      if (rel === 0 || rel === 4) return null
      return `${start}${rel < 4 ? 'Q' : 'P'}9K${end}`
    case 'v':
      return rel === 4 ? null : `${start}CK${end}`
    case 'p':
      return `${start}P0K${end}`
    case 'q':
      return `${start}Q0K${end}`
    // pp loops around the circle through D[start+2], qq is its mirror (D[start-1]).
    // When the end is across the field the official path makes one extra full loop
    // (a repeated orbit is a full circle in slide code).
    case 'pp': {
      const k = wrapButton(start + 2)
      return rel === 3 || rel === 4 ? `${start}P${k}P${k}K${end}` : `${start}P${k}K${end}`
    }
    case 'qq': {
      const k = wrapButton(start - 1)
      return rel === 4 || rel === 5 ? `${start}Q${k}Q${k}K${end}` : `${start}Q${k}K${end}`
    }
    case 's':
      return rel === 4 ? `${start}B${wrapButton(start + 6)}B${wrapButton(start + 2)}K${end}` : null
    case 'z':
      return rel === 4 ? `${start}B${wrapButton(start + 2)}B${wrapButton(start + 6)}K${end}` : null
    case 'V': {
      const via = seg.vertices[0]!
      const turn = stepsCw(start, via)
      if (turn !== 2 && turn !== 6) return null
      return `${start}A${via}K${end}`
    }
    case 'w':
      return null
  }
}
