// SPDX-License-Identifier: GPL-3.0-only

/** A position on the play field: one of the 8 buttons, or a touch sensor. */
export type Location =
  | { group: 'button'; index: number } // 1..8
  | { group: 'A' | 'B' | 'D' | 'E'; index: number } // 1..8
  | { group: 'C'; index: 1 }

export type NoteKind = 'tap' | 'hold' | 'touch' | 'touchHold'

/**
 * How the head of a tap is drawn.
 * - auto: star if the note has slides, otherwise a normal tap
 * - star / spinStar: forced star (`$` / `$$`)
 * - tap: forced normal tap even with slides (`@`)
 * - none: slide with no head at all (`?` fades the slide in, `!` shows it suddenly)
 */
export type HeadStyle = 'auto' | 'star' | 'spinStar' | 'tap' | 'none'

export type SlideShape =
  | '-' // straight
  | '^' // ring, shortest way
  | '>' // ring, clockwise from the player's view when starting in the upper half
  | '<' // ring, the other way
  | 'v' // through the centre
  | 'p' | 'q' // curve around the centre
  | 'pp' | 'qq' // big curve
  | 's' | 'z' // zig-zag
  | 'V' // grand V (two vertices)
  | 'w' // wifi / fan

export interface SlideSegment {
  shape: SlideShape
  /** Button indices (1..8) the segment passes; the last one is where it ends. */
  vertices: number[]
}

export interface SlidePath {
  segments: SlideSegment[]
  /** Seconds between the star tap and the start of the slide (default: one beat). */
  delay: number
  /** Seconds the slide takes once it starts. */
  duration: number
  isBreak: boolean
}

export interface Note {
  kind: NoteKind
  location: Location
  /** Chart time in seconds, before `&first` is applied. */
  time: number
  /** Hold length in seconds (0 for taps and touches). */
  length: number
  isBreak: boolean
  isEx: boolean
  isMine: boolean
  /** Touch firework (`f`). */
  isFirework: boolean
  head: HeadStyle
  slides: SlidePath[]
  /** Set by the parser for notes that share a time slot with other notes. */
  isEach: boolean
  /** Speed multiplier from MajSimai `<HS*x>` (1 = normal, negative = notes come from outside). */
  hspeed: number
}

export interface TimingPoint {
  time: number
  bpm: number
}

export interface ParseError {
  line: number
  column: number
  message: string
}

export interface Chart {
  /** Notes sorted by time. */
  notes: Note[]
  timingPoints: TimingPoint[]
  /** Time of the `E` marker, or the end of the last note. */
  endTime: number
  errors: ParseError[]
}

export interface Difficulty {
  /** maidata index: 1 Easy, 2 Basic, 3 Advanced, 4 Expert, 5 Master, 6 Re:Master, 7 Utage */
  index: number
  level?: string
  designer?: string
  /** Raw simai text of `&inote_N`. */
  chart: string
  /** Per-difficulty `&first_N`, if set. */
  first?: number
}

export interface Maidata {
  title: string
  artist: string
  /** Seconds from the start of the audio to chart time 0. */
  first: number
  /** Every `&key=value` pair as written. */
  meta: Record<string, string>
  difficulties: Difficulty[]
}
