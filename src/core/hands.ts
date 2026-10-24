// SPDX-License-Identifier: GPL-3.0-only
//
// Hand pieces for slide puzzles: up to two hands are placed on the sensors step by step and
// the slide judge reads what they cover. A small hand covers one sensor; a big hand covers two
// neighbouring ones (round the same ring, A-B on the same side, or B and C).
import { SlideJudge, type StepState } from './slideCheck'

export type HandSize = 'small' | 'big'

/** What a hand does in one step. `tap` presses and lets go again before the next step. */
export type HandAction =
  | { kind: 'press'; at: string }
  | { kind: 'tap'; at: string }
  /** Move while staying down: not a new touch. */
  | { kind: 'slide'; to: string }
  | { kind: 'release' }

export const MAX_HANDS = 2

const ring = (g: string) => Array.from({ length: 8 }, (_, i) => `${g}${i + 1}`)

/** Places a small hand can cover. */
export const SMALL_HAND_SPOTS: readonly string[] = [...ring('A'), ...ring('B'), 'C', ...ring('D'), ...ring('E')]

/** Places a big hand can cover, written "A1+A2". */
export const BIG_HAND_SPOTS: readonly string[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `A${i}+A${(i % 8) + 1}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `B${i}+B${(i % 8) + 1}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `A${i}+B${i}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `B${i}+C`),
]

/** The sensors a hand of this size covers at `spot`, or null if it cannot go there. */
export function handSensors(size: HandSize, spot: string): string[] | null {
  if (size === 'small') return SMALL_HAND_SPOTS.includes(spot) ? [spot] : null
  return BIG_HAND_SPOTS.includes(spot) ? spot.split('+') : null
}

/** Where a hand is in one frame. */
export interface HandPose {
  size: HandSize
  /** Null while lifted. */
  at: string | null
}

export interface Frame {
  /** The step this frame belongs to (a tap adds a second frame to its step). */
  step: number
  hands: HandPose[]
  pressed: string[]
  judge: StepState[][][]
  finished: boolean
}

export interface HandRun {
  frames: Frame[]
  /** Presses and taps; slides are not new touches. */
  touches: number
  finished: boolean
  /** First step after which the slide was complete, or null. */
  finishedAtStep: number | null
  /** The first move that cannot be made; the run stops before it. */
  error: { step: number; hand: number; message: string } | null
}

/**
 * Play a list of steps on a slide judge. `steps[k][h]` is what hand h does in step k (null:
 * nothing). Within a step every hand acts at once; a tap is let go in a second frame.
 */
export function runHands(judge: SlideJudge, sizes: HandSize[], steps: (HandAction | null)[][]): HandRun {
  const run: HandRun = { frames: [], touches: 0, finished: false, finishedAtStep: null, error: null }
  if (sizes.length > MAX_HANDS) {
    run.error = { step: 0, hand: MAX_HANDS, message: `最多只能用 ${MAX_HANDS} 只手` }
    return run
  }
  const at: (string | null)[] = sizes.map(() => null)

  const frame = (step: number) => {
    const pressed = new Set<string>()
    at.forEach((spot, h) => {
      if (spot) for (const s of handSensors(sizes[h]!, spot)!) pressed.add(s)
    })
    judge.check(pressed)
    run.frames.push({
      step,
      hands: sizes.map((size, h) => ({ size, at: at[h]! })),
      pressed: [...pressed],
      judge: judge.state(),
      finished: judge.finished,
    })
    if (judge.finished && run.finishedAtStep === null) run.finishedAtStep = step
  }

  steps: for (let k = 0; k < steps.length; k++) {
    const tapped: number[] = []
    for (const [h, a] of steps[k]!.entries()) {
      if (!a) continue
      const message = h < sizes.length ? invalid(a, sizes[h]!, at[h] !== null) : '没有这只手'
      if (message) {
        run.error = { step: k, hand: h, message }
        break steps
      }
      if (a.kind === 'press' || a.kind === 'tap') run.touches++
      if (a.kind === 'tap') tapped.push(h)
      at[h] = a.kind === 'slide' ? a.to : a.kind === 'release' ? null : a.at
    }
    frame(k)
    if (tapped.length) {
      for (const h of tapped) at[h] = null
      frame(k)
    }
  }
  run.finished = judge.finished
  return run
}

/** Why a hand cannot do this, or null if it can. */
function invalid(a: HandAction, size: HandSize, down: boolean): string | null {
  const target = a.kind === 'slide' ? a.to : a.kind === 'release' ? null : a.at
  if (target !== null && !handSensors(size, target)) return `${size === 'big' ? '大手' : '小手'}不能放在 ${target}`
  if ((a.kind === 'press' || a.kind === 'tap') && down) return '这只手已经按着了，要换位置请用滑动'
  if ((a.kind === 'slide' || a.kind === 'release') && !down) return '这只手没有按着'
  return null
}
