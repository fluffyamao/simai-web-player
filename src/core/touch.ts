// SPDX-License-Identifier: GPL-3.0-only
//
// Touch note geometry and motion, ported from MajdataPlay (GPL-3.0):
//   Assets/Scripts/Scenes/Game/Utils/NoteHelper.cs              (GetTouchAreaPosition)
//   Assets/Scripts/Scenes/Game/NoteBehaviours/TouchDrop.cs      (fan motion)
//   Assets/Scripts/Scenes/Game/NoteBehaviours/TouchHoldDrop.cs  (hold progress)
import type { Location } from '../parser/types'
import type { Vec2 } from './geometry'

const AREA_DISTANCE = { A: 4.0, B: 2.2, C: 0, D: 4.1, E: 3.1 } as const

/** Centre of a touch sensor in world units. A/B line up with buttons, D/E sit between them. */
export function touchPosition(loc: Location): Vec2 {
  if (loc.group === 'C' || loc.group === 'button') return { x: 0, y: 0 }
  const offset = loc.group === 'A' || loc.group === 'B' ? (Math.PI * 5) / 8 : (Math.PI * 6) / 8
  const angle = -loc.index * (Math.PI / 4) + offset
  const d = AREA_DISTANCE[loc.group]
  return { x: d * Math.cos(angle), y: d * Math.sin(angle) }
}

/** Rotation that makes a touch's "up" piece point away from the centre (C is not rotated). */
export function touchRotation(loc: Location): number {
  if (loc.group === 'C') return 0
  const p = touchPosition(loc)
  return Math.atan2(p.y, p.x) - Math.PI / 2
}

export interface TouchTiming {
  /** Seconds before the hit when the touch appears. */
  whole: number
  /** Last part of `whole` during which the pieces move in. */
  move: number
  /** First part of `whole` during which the pieces fade in. */
  display: number
}

/** Touch timing for the in-game touch speed setting (default 7.5). */
export function touchTiming(touchSpeed: number): TouchTiming {
  const whole = 3.209385682 * Math.pow(Math.abs(touchSpeed), -0.9549621752)
  return { whole, move: 0.8 * whole, display: 0.2 * whole }
}

/** Distance of each piece from the touch centre at its closest. */
export const TOUCH_PIECE_BASE = 0.226

export interface TouchState {
  alpha: number
  /** Extra distance of the pieces from TOUCH_PIECE_BASE, 0.4 when far, 0 when hit. */
  spread: number
}

/** @param sinceHit seconds since the hit time (negative before it); null when not visible */
export function touchState(sinceHit: number, t: TouchTiming): TouchState | null {
  if (-sinceHit >= t.whole) return null
  if (sinceHit >= 0) return { alpha: 1, spread: 0 }
  if (-sinceHit >= t.move) {
    // still fading in, pieces wait at their furthest
    return { alpha: Math.min(Math.max((t.whole + sinceHit) / t.display, 0), 1), spread: 0.4 }
  }
  const pow = -Math.exp(8 * ((sinceHit * 0.43) / t.move) - 0.85) + 0.42
  return { alpha: 1, spread: Number.isNaN(pow) ? 0 : Math.min(Math.max(pow, 0), 0.4) }
}
