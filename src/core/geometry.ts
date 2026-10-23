// SPDX-License-Identifier: GPL-3.0-only
//
// Play-field geometry and note motion, ported from MajdataPlay (GPL-3.0):
//   Assets/Scripts/Scenes/Game/Utils/NoteHelper.cs        (positions)
//   Assets/Scripts/Scenes/Game/NoteBehaviours/TapDrop.cs   (tap motion)
//   Assets/Scripts/Scenes/Game/NoteBehaviours/HoldDrop.cs  (hold motion)
//   Assets/Scripts/Scenes/Game/GamePlayManager.cs          (speed setting -> units/s)
// Units are MajdataPlay world units: the judge ring has radius 4.8, y points up.

/** Radius of the judge ring, where notes are hit. */
export const JUDGE_RADIUS = 4.8
/** Radius where taps appear and start to grow. */
export const SPAWN_RADIUS = 1.225
/** How fast a note grows while it sits at the spawn point (MajdataPlay "NoteAppearRate"). */
export const NOTE_APPEAR_RATE = 0.265

export interface Vec2 {
  x: number
  y: number
}

/** Point on the ring for button 1..8 (fractional positions allowed). */
export function buttonPoint(position: number, distance: number): Vec2 {
  const angle = (position * -2 + 5) * 0.125 * Math.PI
  return { x: distance * Math.cos(angle), y: distance * Math.sin(angle) }
}

/** Angle in radians of button 1..8, same convention as {@link buttonPoint}. */
export function buttonAngle(position: number): number {
  return (position * -2 + 5) * 0.125 * Math.PI
}

/**
 * Convert the in-game "tap speed" setting (1.0 .. 10.0, default 7.5)
 * into world units per second.
 */
export function noteSpeedFromSetting(tapSpeed: number): number {
  const s = Math.abs(tapSpeed)
  const speed = 107.25 / (71.4184491 * Math.pow(s + 0.9975, -0.985558604))
  return tapSpeed < 0 ? -speed : speed
}

export interface TapState {
  /** Distance from the centre, in world units. */
  distance: number
  /** Drawing scale, 0..1 (notes grow at the spawn point first). */
  scale: number
}

/**
 * Where a tap (or hold head) is drawn.
 * @param sinceHit seconds since the note's hit time (negative before it)
 * @param speed world units per second
 * @returns null while the note is not visible yet
 */
export function tapState(sinceHit: number, speed: number): TapState | null {
  const distance = sinceHit * speed + JUDGE_RADIUS
  const scale = distance * NOTE_APPEAR_RATE + (1 - NOTE_APPEAR_RATE * SPAWN_RADIUS)
  if (scale < 0) return null
  if (distance < SPAWN_RADIUS) return { distance: SPAWN_RADIUS, scale: Math.min(scale, 1) }
  return { distance, scale: 1 }
}

/** Seconds before the hit time when a note becomes visible. */
export function appearLead(speed: number): number {
  // scale reaches 0 when distance = -(1 - rate * spawn) / rate
  const d = -(1 - NOTE_APPEAR_RATE * SPAWN_RADIUS) / NOTE_APPEAR_RATE
  return (JUDGE_RADIUS - d) / speed
}

export interface HoldState {
  /** Head distance (outer end), clamped to the judge ring. */
  head: number
  /** Tail distance (inner end), clamped to the spawn point. */
  tail: number
  scale: number
}

/**
 * Where a hold is drawn. Before the head has grown in it behaves like a tap;
 * afterwards the body stretches from the tail to the head.
 */
export function holdState(sinceHit: number, length: number, speed: number): HoldState | null {
  const head = tapState(sinceHit, speed)
  if (!head) return null
  if (head.scale < 1) return { head: head.distance, tail: head.distance, scale: head.scale }
  const tail = (sinceHit - length) * speed + JUDGE_RADIUS
  if (tail >= JUDGE_RADIUS) return null
  return {
    head: Math.min(head.distance, JUDGE_RADIUS),
    tail: Math.max(tail, SPAWN_RADIUS),
    scale: 1,
  }
}
