// SPDX-License-Identifier: GPL-3.0-only
//
// Hand pieces for slide puzzles: up to two hands are placed on the sensors step by step and
// the slide judge reads what they cover. Each move says how big the hand is: a small hand covers
// one sensor, a big hand any two.
import { SlideJudge, type StepState } from './slideCheck'

export type HandSize = 'small' | 'big'

/**
 * What a hand does in one step. `tap` presses and lets go again before the next step; `slide`
 * moves while staying down (not a new touch) and may change the hand's size.
 */
export type HandAction =
  | { kind: 'press'; size: HandSize; at: string }
  | { kind: 'tap'; size: HandSize; at: string }
  | { kind: 'slide'; size: HandSize; to: string }
  | { kind: 'release' }

export const MAX_HANDS = 2

const ring = (g: string) => Array.from({ length: 8 }, (_, i) => `${g}${i + 1}`)

/** Every sensor a hand can touch, in board order. */
export const SENSOR_SPOTS: readonly string[] = [...ring('A'), ...ring('B'), 'C', ...ring('D'), ...ring('E')]

/** A big hand's spot over two different sensors, written "A1+B3" in board order; null if invalid. */
export function bigHandSpot(a: string, b: string): string | null {
  const i = SENSOR_SPOTS.indexOf(a)
  const j = SENSOR_SPOTS.indexOf(b)
  if (i < 0 || j < 0 || i === j) return null
  return i < j ? `${a}+${b}` : `${b}+${a}`
}

/** The sensors a hand of this size covers at `spot`, or null if it cannot go there. */
export function handSensors(size: HandSize, spot: string): string[] | null {
  if (size === 'small') return SENSOR_SPOTS.includes(spot) ? [spot] : null
  const [a, b, more] = spot.split('+')
  return a && b && !more && bigHandSpot(a, b) ? [a, b] : null
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
export function runHands(judge: SlideJudge, steps: (HandAction | null)[][]): HandRun {
  const run: HandRun = { frames: [], touches: 0, finished: false, finishedAtStep: null, error: null }
  const hands: HandPose[] = Array.from({ length: MAX_HANDS }, () => ({ size: 'small', at: null }))

  const frame = (step: number) => {
    const pressed = new Set<string>()
    for (const hand of hands) if (hand.at) for (const s of handSensors(hand.size, hand.at)!) pressed.add(s)
    judge.check(pressed)
    run.frames.push({
      step,
      hands: hands.map((hand) => ({ ...hand })),
      pressed: [...pressed],
      judge: judge.state(),
      finished: judge.finished,
    })
    if (judge.finished && run.finishedAtStep === null) run.finishedAtStep = step
  }

  steps: for (let k = 0; k < steps.length; k++) {
    const tapped: HandPose[] = []
    for (const [h, a] of steps[k]!.entries()) {
      if (!a) continue
      const hand = hands[h]
      const message = hand ? invalid(a, hand.at !== null) : `最多只能用 ${MAX_HANDS} 只手`
      if (message) {
        run.error = { step: k, hand: h, message }
        break steps
      }
      if (a.kind === 'release') {
        hand!.at = null
        continue
      }
      if (a.kind !== 'slide') run.touches++
      if (a.kind === 'tap') tapped.push(hand!)
      hand!.size = a.size
      hand!.at = a.kind === 'slide' ? a.to : a.at
    }
    frame(k)
    if (tapped.length) {
      for (const hand of tapped) hand.at = null
      frame(k)
    }
  }
  run.finished = judge.finished
  return run
}

/** Why a hand cannot do this, or null if it can. */
function invalid(a: HandAction, down: boolean): string | null {
  if (a.kind !== 'release') {
    const target = a.kind === 'slide' ? a.to : a.at
    if (!handSensors(a.size, target)) return a.size === 'big' ? `大手要放在两个不同的感应区上（${target}）` : `小手不能放在 ${target}`
  }
  if ((a.kind === 'press' || a.kind === 'tap') && down) return '这只手已经按着了，要换位置请用滑动'
  if ((a.kind === 'slide' || a.kind === 'release') && !down) return '这只手没有按着'
  return null
}
