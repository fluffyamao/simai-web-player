// SPDX-License-Identifier: GPL-3.0-only
//
// simai chart parser. The grammar follows the simai documentation
// (https://w.atwiki.jp/simai/) and the behaviour of SimaiSharp (MIT,
// https://github.com/reflektone-games/SimaiSharp); the code is written from scratch.
import type {
  Chart,
  Location,
  Note,
  ParseError,
  SlidePath,
  SlideShape,
  TimingPoint,
} from './types'

type TokenType =
  | 'step' // ,
  | 'tempo' // (bpm)
  | 'subdivision' // {n} or {#seconds}
  | 'duration' // [...]
  | 'location' // 1..8, A1..E8, C
  | 'decorator' // b x h f m ? ! @ $
  | 'slide' // - ^ < > v V p q pp qq s z w
  | 'slideJoiner' // *
  | 'each' // /
  | 'pseudoEach' // `
  | 'end' // E
  | 'hspeed' // <HS*x>

interface Token {
  type: TokenType
  text: string
  line: number
  column: number
}

const DECORATORS = new Set(['b', 'x', 'h', 'f', 'm', '?', '!', '@', '$'])
const SLIDE_CHARS = new Set(['-', '^', '<', '>', 'v', 'V', 'p', 'q', 's', 'z', 'w'])
const SECTIONS: Record<string, [TokenType, string]> = {
  '(': ['tempo', ')'],
  '{': ['subdivision', '}'],
  '[': ['duration', ']'],
}

function tokenize(src: string, errors: ParseError[]): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  const push = (type: TokenType, text: string, start: number) =>
    tokens.push({ type, text, line, column: start - lineStart + 1 })
  const error = (message: string, at = i) =>
    errors.push({ line, column: at - lineStart + 1, message })

  while (i < src.length) {
    const c = src[i]!
    const start = i

    if (c === '\n') {
      i++
      line++
      lineStart = i
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    // `||` comment to end of line
    if (c === '|' && src[i + 1] === '|') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    // MajSimai tags: <HS*1.5> changes note speed from here on; <SV*x> is ignored
    const tag = c === '<' ? /^<(HS|SV)\*([^>]*)>/.exec(src.slice(i, i + 24)) : null
    if (tag) {
      if (tag[1] === 'HS') push('hspeed', tag[2]!.trim(), start)
      i += tag[0].length
      continue
    }
    const section = SECTIONS[c]
    if (section) {
      const close = src.indexOf(section[1], i + 1)
      const nl = src.indexOf('\n', i + 1)
      if (close === -1 || (nl !== -1 && nl < close)) {
        error(`unterminated ${c}`)
        i++
        continue
      }
      push(section[0], src.slice(i + 1, close).trim(), start)
      i = close + 1
      continue
    }
    if (c === ',') {
      push('step', c, start)
      i++
      continue
    }
    if (c >= '0' && c <= '8') {
      push('location', c, start)
      i++
      continue
    }
    if (c >= 'A' && c <= 'E') {
      const next = src[i + 1] ?? ''
      if (next >= '0' && next <= '8') {
        push('location', c + next, start)
        i += 2
        continue
      }
      if (c === 'C') {
        push('location', 'C', start)
        i++
        continue
      }
      if (c === 'E') {
        push('end', c, start)
        i++
        continue
      }
      error(`expected a number after ${c}`)
      i++
      continue
    }
    if (DECORATORS.has(c)) {
      push('decorator', c, start)
      i++
      continue
    }
    if (SLIDE_CHARS.has(c)) {
      const next = src[i + 1]
      const double = (c === 'p' || c === 'q') && next === c
      push('slide', double ? c + c : c, start)
      i += double ? 2 : 1
      continue
    }
    if (c === '*') {
      push('slideJoiner', c, start)
      i++
      continue
    }
    if (c === '/') {
      push('each', c, start)
      i++
      continue
    }
    if (c === '`') {
      push('pseudoEach', c, start)
      i++
      continue
    }
    error(`unexpected character ${JSON.stringify(c)}`)
    i++
  }
  return tokens
}

function parseLocation(text: string): Location | null {
  const head = text[0]!
  if (head >= '1' && head <= '8') return { group: 'button', index: Number(head) }
  if (head === 'C') return { group: 'C', index: 1 }
  const index = Number(text.slice(1))
  if (index < 1 || index > 8) return null
  return { group: head as 'A' | 'B' | 'D' | 'E', index }
}

/** `a:b` = b notes of an a-th note at `bpm`, or a plain number of seconds. */
function beatsOrSeconds(text: string, bpm: number): number {
  const colon = text.indexOf(':')
  if (colon === -1) return parseFloat(text)
  const a = parseFloat(text.slice(0, colon))
  const b = parseFloat(text.slice(colon + 1))
  return (240 / bpm / a) * b
}

/** Hold length: `[a:b]`, `[bpm#a:b]` or `[#seconds]`. */
function holdLength(text: string, bpm: number): number {
  const hash = text.indexOf('#')
  if (hash === 0) return parseFloat(text.slice(1))
  if (hash > 0) return beatsOrSeconds(text.slice(hash + 1), parseFloat(text.slice(0, hash)))
  return beatsOrSeconds(text, bpm)
}

/**
 * Slide timing:
 * - `[a:b]`             delay one beat, duration a:b at the current bpm
 * - `[bpm#a:b]`         delay one beat at bpm, duration a:b at bpm (or `[bpm#seconds]`)
 * - `[delay##a:b]`      delay in seconds, duration a:b at the current bpm (or `[delay##seconds]`)
 */
function slideTiming(text: string, bpm: number): { delay?: number; duration: number } {
  const dd = text.indexOf('##')
  if (dd !== -1) {
    return { delay: parseFloat(text.slice(0, dd)), duration: beatsOrSeconds(text.slice(dd + 2), bpm) }
  }
  const hash = text.indexOf('#')
  if (hash !== -1) {
    const override = hash > 0 ? parseFloat(text.slice(0, hash)) : bpm
    return { delay: 60 / override, duration: beatsOrSeconds(text.slice(hash + 1), override) }
  }
  return { duration: beatsOrSeconds(text, bpm) }
}

const isTerminator = (t: Token) =>
  t.type === 'step' ||
  t.type === 'each' ||
  t.type === 'pseudoEach' ||
  t.type === 'end' ||
  t.type === 'location' ||
  t.type === 'tempo' ||
  t.type === 'subdivision'

export interface ParseOptions {
  /** bpm used until the chart sets one, e.g. `&wholebpm`. */
  defaultBpm?: number
}

export function parseSimai(src: string, options: ParseOptions = {}): Chart {
  const errors: ParseError[] = []
  const tokens = tokenize(src, errors)
  const notes: Note[] = []
  const timingPoints: TimingPoint[] = []

  let bpm = options.defaultBpm && options.defaultBpm > 0 ? options.defaultBpm : 120
  let subdivision = 4
  let fixedStep: number | null = null // seconds per comma from {#x}
  let time = 0
  let endTime: number | null = null
  let hspeed = 1
  let group: Note[] = []
  let groupBroken = false
  let pos = 0

  const error = (t: Token, message: string) =>
    errors.push({ line: t.line, column: t.column, message })
  const peek = () => tokens[pos]
  const finishGroup = () => {
    if (group.length > 0 && !groupBroken) markEach(group)
    notes.push(...group)
    group = []
    groupBroken = false
  }

  function readSlide(): SlidePath {
    const path: SlidePath = { segments: [], delay: 60 / bpm, duration: 0, isBreak: false }
    while (pos < tokens.length) {
      const t = peek()!
      if (t.type === 'slide') {
        pos++
        const shape = t.text as SlideShape
        const need = shape === 'V' ? 2 : 1
        const vertices: number[] = []
        while (vertices.length < need) {
          // some charts put decorators between the shape and the end, e.g. `4qx8`
          if (peek()?.type === 'decorator') {
            if (peek()!.text === 'b') path.isBreak = true
            pos++
            continue
          }
          if (peek()?.type !== 'location') break
          const loc = parseLocation(peek()!.text)
          if (!loc || loc.group !== 'button') break
          vertices.push(loc.index)
          pos++
        }
        if (vertices.length < need) {
          error(t, `slide ${shape} needs ${need} end position(s)`)
          continue
        }
        path.segments.push({ shape, vertices })
      } else if (t.type === 'duration') {
        pos++
        const timing = slideTiming(t.text, bpm)
        if (!Number.isFinite(timing.duration)) error(t, `bad slide duration [${t.text}]`)
        else path.duration += timing.duration
        if (timing.delay !== undefined && Number.isFinite(timing.delay)) path.delay = timing.delay
      } else if (t.type === 'decorator') {
        pos++
        if (t.text === 'b') path.isBreak = true
        // other decorators on a slide (e.g. x) have no visual effect yet
      } else if (t.type === 'slideJoiner') {
        pos++
        break
      } else {
        break
      }
    }
    if (path.segments.length === 0) error(tokens[pos - 1] ?? tokens[0]!, 'empty slide')
    return path
  }

  function readNote(loc: Location): Note {
    const note: Note = {
      kind: loc.group === 'button' ? 'tap' : 'touch',
      location: loc,
      time,
      length: 0,
      isBreak: false,
      isEx: false,
      isMine: false,
      isFirework: false,
      head: 'auto',
      slides: [],
      isEach: false,
      hspeed,
    }
    while (pos < tokens.length) {
      const t = peek()!
      if (isTerminator(t)) break
      pos++
      switch (t.type) {
        case 'decorator':
          switch (t.text) {
            case 'b': note.isBreak = true; break
            case 'x': note.isEx = true; break
            case 'm': note.isMine = true; break
            case 'f': note.isFirework = true; break
            case 'h': note.kind = note.kind === 'touch' ? 'touchHold' : note.kind === 'tap' ? 'hold' : note.kind; break
            case '?':
            case '!': note.head = 'none'; break
            case '@': note.head = 'tap'; break
            case '$': note.head = note.head === 'star' ? 'spinStar' : 'star'; break
          }
          break
        case 'duration': {
          const length = holdLength(t.text, bpm)
          if (!Number.isFinite(length)) {
            error(t, `bad hold length [${t.text}]`)
            break
          }
          note.length = length
          if (note.kind === 'tap') note.kind = 'hold'
          if (note.kind === 'touch') note.kind = 'touchHold'
          break
        }
        case 'slide':
          if (loc.group !== 'button') {
            error(t, 'slides must start from a button')
            pos--
            readSlide() // consume and drop it
            break
          }
          pos--
          note.slides.push(readSlide())
          break
        case 'slideJoiner':
          break
        default:
          error(t, `unexpected ${t.text}`)
      }
    }
    return note
  }

  while (pos < tokens.length) {
    const t = tokens[pos++]!
    switch (t.type) {
      case 'tempo': {
        const value = parseFloat(t.text)
        if (!(value > 0)) {
          error(t, `bad bpm (${t.text})`)
          break
        }
        bpm = value
        const last = timingPoints[timingPoints.length - 1]
        if (last && Math.abs(last.time - time) < 1e-9) last.bpm = bpm
        else timingPoints.push({ time, bpm })
        break
      }
      case 'subdivision': {
        if (t.text.startsWith('#')) {
          const value = parseFloat(t.text.slice(1))
          if (value > 0) fixedStep = value
          else error(t, `bad step {${t.text}}`)
        } else {
          const value = parseFloat(t.text)
          if (value > 0) {
            subdivision = value
            fixedStep = null
          } else error(t, `bad subdivision {${t.text}}`)
        }
        break
      }
      case 'location': {
        if (t.text === '0') break // "0" only forces each, nothing to draw
        const loc = parseLocation(t.text)
        if (!loc) {
          error(t, `bad position ${t.text}`)
          break
        }
        group.push(readNote(loc))
        break
      }
      case 'step':
        finishGroup()
        time += fixedStep ?? (60 / bpm) * (4 / subdivision)
        break
      case 'each':
        break
      case 'hspeed': {
        const value = parseFloat(t.text)
        if (Number.isFinite(value) && value !== 0) hspeed = value
        else error(t, `bad hi-speed <HS*${t.text}>`)
        break
      }
      case 'pseudoEach':
        groupBroken = true
        break
      case 'end':
        endTime ??= time
        break
      default:
        error(t, `unexpected ${t.text} outside a note`)
    }
  }
  finishGroup()

  if (timingPoints.length === 0) timingPoints.push({ time: 0, bpm })
  notes.sort((a, b) => a.time - b.time)
  const lastEnd = notes.reduce((max, n) => Math.max(max, noteEndTime(n)), 0)
  return { notes, timingPoints, endTime: endTime ?? lastEnd, errors }
}

/** Chart time when the note has completely finished (hold tail or slide end). */
export function noteEndTime(note: Note): number {
  let end = note.time + note.length
  for (const s of note.slides) end = Math.max(end, note.time + s.delay + s.duration)
  return end
}

function markEach(group: Note[]) {
  const buttons = group.filter((n) => n.location.group === 'button' && n.head !== 'none')
  if (buttons.length >= 2) for (const n of buttons) n.isEach = true
  const touches = group.filter((n) => n.location.group !== 'button')
  if (touches.length >= 2) for (const n of touches) n.isEach = true
}
