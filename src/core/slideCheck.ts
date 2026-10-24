// SPDX-License-Identifier: GPL-3.0-only
//
// Slide judging frame by frame, without timing, ported from MajdataPlay (GPL-3.0):
//   Scenes/Game/Misc/Notes/Slide/SlideArea.cs        a step: on, off, finished
//   Scenes/Game/NoteBehaviours/SlideBase.cs          SensorCheck: walking the queue, skipping
//   Scenes/Game/NoteBehaviours/SingleSlideBase.cs    SlideCheck / SensorCheck: connected parts
//   Scenes/Game/NoteBehaviours/WifiDrop.cs           three lanes, done when all are empty
//
// Each frame the judge is told which sensors are pressed. The game only reads the sensors of the
// step at the head of a queue and of the step after it, so a touch elsewhere does nothing.
import { slideQueues, type JudgeStep } from './slideJudge'
import type { SlidePath } from '../parser/types'

/** One sensor of a step (SlideArea.Area). */
interface SensorMark {
  name: string
  wasOn: boolean
  wasOff: boolean
}

export interface StepState {
  sensors: string[]
  skippable: boolean
  last: boolean
  /** Some sensor of the step has been read as pressed. */
  on: boolean
  /** Pressed and released again, or just pressed for the last step. */
  finished: boolean
  /** Left the queue. */
  cleared: boolean
}

class Step {
  readonly marks: SensorMark[]

  constructor(readonly def: JudgeStep) {
    this.marks = [...new Set(def.sensors)].map((name) => ({ name, wasOn: false, wasOff: false }))
  }

  /** SlideArea.Check for each of its sensors; `off` is only noted once the sensor was on. */
  check(pressed: ReadonlySet<string>) {
    for (const m of this.marks) {
      if (pressed.has(m.name)) m.wasOn = true
      else if (m.wasOn) m.wasOff = true
    }
  }

  get on() {
    return this.marks.some((m) => m.wasOn)
  }

  /** Either sensor finished (AreaPolicy.OR). */
  get finished() {
    return this.marks.some((m) => (this.def.last ? m.wasOn : m.wasOn && m.wasOff))
  }
}

class Lane {
  readonly steps: Step[]
  head = 0

  constructor(defs: JudgeStep[]) {
    this.steps = defs.map((d) => new Step(d))
  }

  get remaining() {
    return this.steps.length - this.head
  }

  /** SlideBase.SensorCheck for one queue; returns whether any step was touched. */
  check(pressed: ReadonlySet<string>): boolean {
    let triggered = false
    while (this.head < this.steps.length) {
      const first = this.steps[this.head]!
      const second = this.steps[this.head + 1]
      first.check(pressed)
      // the next step is only read when the head may be skipped or is already on
      if (second && (first.def.skippable || first.on)) {
        second.check(pressed)
        if (second.finished) {
          this.head += 2
          triggered = true
          continue
        }
        if (second.on) {
          this.head += 1
          triggered = true
          continue
        }
      }
      if (first.finished) {
        this.head += 1
        triggered = true
      } else if (first.on) triggered = true
      break
    }
    return triggered
  }

  /** Slide.ForceFinish: a later part took over. */
  clear() {
    this.head = this.steps.length
  }
}

/** One segment of the slide: a queue, or three lanes for wifi. */
class Part {
  readonly lanes: Lane[]
  checkable = false

  constructor(lanes: JudgeStep[][]) {
    this.lanes = lanes.map((l) => new Lane(l))
  }

  /** SlideBase.QueueRemaining: the longest lane. */
  get remaining() {
    return Math.max(...this.lanes.map((l) => l.remaining))
  }
}

export class SlideJudge {
  private readonly parts: Part[]
  /** Frames checked so far. */
  frames = 0

  constructor(queues: JudgeStep[][][]) {
    this.parts = queues.map((q) => new Part(q))
  }

  /** A judge for a slide starting at button `start`; null if the game would reject the slide. */
  static forSlide(start: number, slide: SlidePath): SlideJudge | null {
    const queues = slideQueues(start, slide)
    return queues ? new SlideJudge(queues) : null
  }

  /** Every queue is empty. */
  get finished() {
    return this.parts[this.parts.length - 1]!.remaining === 0
  }

  /** Read one frame of sensor states ("A1" .. "E8", "C"). */
  check(pressed: Iterable<string>) {
    const set = pressed instanceof Set ? (pressed as ReadonlySet<string>) : new Set(pressed)
    this.frames++
    // SlideCheck runs for every part before any of them reads the sensors: the head part is
    // checkable at once (no timing here), a later part once the one before has at most one step
    this.parts.forEach((p, i) => {
      if (!p.checkable) p.checkable = i === 0 || this.parts[i - 1]!.remaining <= 1
    })
    this.parts.forEach((p, i) => {
      if (!p.checkable || p.remaining === 0) return
      let triggered = false
      for (const lane of p.lanes) if (lane.check(set)) triggered = true
      // touching a step of a later part finishes the part before it
      if (triggered && i > 0) {
        const parent = this.parts[i - 1]!
        if (parent.remaining > 0) for (const lane of parent.lanes) lane.clear()
      }
    })
  }

  /** The state of every step: parts, then lanes, then steps in queue order. */
  state(): StepState[][][] {
    return this.parts.map((p) =>
      p.lanes.map((lane) =>
        lane.steps.map((s, k) => ({
          sensors: s.def.sensors,
          skippable: s.def.skippable,
          last: s.def.last,
          on: s.on,
          finished: s.finished,
          cleared: k < lane.head,
        })),
      ),
    )
  }
}
