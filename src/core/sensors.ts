// SPDX-License-Identifier: GPL-3.0-only
//
// Outline of the 33 touch sensors, for the sensor overlay (MajdataPlay's Debug.DisplaySensor).
// MajdataPlay ships the shapes as baked meshes; these are polar approximations that put every
// area where the game puts it, in world units with y up.
import type { Vec2 } from './geometry'
import { touchPosition } from './touch'

export interface SensorArea {
  /** "A1" .. "E8", or "C" */
  name: string
  /** closed outline */
  points: Vec2[]
  /** where the label goes */
  centre: Vec2
}

const C_RADIUS = 1.15
const B_OUTER = 3.0
const A_OUTER = 4.8
const STEP = Math.PI / 4

/** Angle of button / A / B sensor n (1..8); D / E sensors sit half a step anticlockwise. */
const buttonAngle = (n: number) => -n * STEP + (Math.PI * 5) / 8

const polar = (r: number, a: number): Vec2 => ({ x: r * Math.cos(a), y: r * Math.sin(a) })

/** Annular sector from r1 to r2 between angles a1 and a2 (a1 > a2, clockwise). */
function sector(r1: number, r2: number, a1: number, a2: number, segments = 8): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++) out.push(polar(r2, a1 + ((a2 - a1) * i) / segments))
  for (let i = segments; i >= 0; i--) out.push(polar(r1, a1 + ((a2 - a1) * i) / segments))
  return out
}

/** Diamond around radius r at angle a, reaching dr outwards and da (radians) sideways. */
function diamond(r: number, a: number, dr: number, da: number): Vec2[] {
  return [polar(r + dr, a), polar(r, a - da), polar(r - dr, a), polar(r, a + da)]
}

function build(): SensorArea[] {
  const areas: SensorArea[] = []
  const add = (name: string, points: Vec2[]) => {
    const centre = name === 'C' ? { x: 0, y: 0 } : touchPosition({ group: name[0] as 'A' | 'B' | 'D' | 'E', index: Number(name.slice(1)) })
    areas.push({ name, points, centre })
  }
  const circle: Vec2[] = []
  for (let i = 0; i < 32; i++) circle.push(polar(C_RADIUS, (i / 32) * Math.PI * 2))
  add('C', circle)
  for (let n = 1; n <= 8; n++) {
    const a = buttonAngle(n)
    add(`B${n}`, sector(C_RADIUS, B_OUTER, a + STEP / 2, a - STEP / 2))
    add(`A${n}`, sector(B_OUTER, A_OUTER, a + STEP / 2, a - STEP / 2))
  }
  // E and D lie across the borders between neighbouring A/B areas, so they go on top
  for (let n = 1; n <= 8; n++) {
    const a = buttonAngle(n) + STEP / 2
    add(`E${n}`, diamond(3.1, a, 0.62, 0.2))
    add(`D${n}`, sector(3.85, A_OUTER + 0.12, a + 0.1, a - 0.1, 2))
  }
  return areas
}

/** Drawing order: C, then B/A, then the E/D areas that overlap them. */
export const SENSOR_AREAS: readonly SensorArea[] = build()
