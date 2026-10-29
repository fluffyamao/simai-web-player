// SPDX-License-Identifier: GPL-3.0-only
//
// Canvas 2D renderer. Note shapes are drawn in code (no game sprites);
// motion comes from ../core/geometry.ts (ported from MajdataPlay).
import {
  appearLead,
  buttonAngle,
  buttonPoint,
  holdState,
  JUDGE_RADIUS,
  SPAWN_RADIUS,
  tapState,
  type Vec2,
} from '../core/geometry'
import {
  TOUCH_PIECE_BASE,
  touchPosition,
  touchState,
  touchTiming,
  type TouchTiming,
} from '../core/touch'
import { noteKey } from '../core/noteKey'
import { SENSOR_AREAS, sensorNames, type SensorArea } from '../core/sensors'
import { noteEndTime } from '../parser/simai'
import type { Chart, Note } from '../parser/types'
import {
  prepareSlides,
  slideProgress,
  starOnPath,
  trackAlpha,
  type PathPart,
  type PreparedSlide,
  type WifiPart,
} from './slides'

/** World units from the centre to the edge of the canvas. */
const VIEW_RADIUS = 5.6
const NOTE_RADIUS = 0.58
const HIT_EFFECT_SEC = 0.25
const FIREWORK_SEC = 1.2
const SLIDE_END_SEC = 0.3
/** How far each of the 11 wifi bars sits from the start, as a fraction of the way to the ends. */
const WIFI_BAR_SCALES = [0.084, 0.148, 0.223, 0.301, 0.381, 0.48, 0.574, 0.668, 0.763, 0.856, 0.965]

/**
 * The guide ring under each tap, star and hold head (MajdataPlay's TapLine,
 * NoteGuideSkins/*.png): a full circle through the note, brightest at the note and
 * fading away on both sides. Opacity by degrees from the note, sampled from the sprite.
 */
const GUIDE_FADE: [number, number][] = [
  [0, 1], [10, 0.95], [20, 0.77], [30, 0.52], [45, 0.27], [60, 0.13],
  [75, 0.08], [90, 0.047], [110, 0.024], [130, 0.012], [150, 0.006], [180, 0],
]
/** Ring width at the judge ring; it scales with the ring's radius. */
const GUIDE_WIDTH = 0.07
/** The ring shows once the note has grown past this scale. */
const GUIDE_MIN_SCALE = 0.3

/**
 * Hit effects are coloured by the judgement, not the note (MajdataPlay's EffectSprites
 * Hex*.png and Star*.png for taps and breaks, HoldEffectDisplayer, touchPerfect/Great/Good.anim).
 */
type Judgement = 'perfect' | 'great' | 'good'
const EFFECT_COLORS: Record<Judgement, { tap: string; break: string; hold: string; touch: string }> = {
  perfect: { tap: '#f8ed6c', break: '#f9ef65', hold: '#ffe300', touch: '#ffe677' },
  great: { tap: '#fe98fe', break: '#fc92b0', hold: '#ffb3f0', touch: '#fface1' },
  good: { tap: '#42f47a', break: '#40f778', hold: '#8fff96', touch: '#5eff67' },
}
/** The player only plays itself, and autoplay hits every note perfectly. */
const AUTOPLAY_JUDGEMENT: Judgement = 'perfect'

/** Sensor polygons by the names a judge step uses ("C" covers both halves). */
const SENSOR_BY_NAME = new Map<string, SensorArea[]>()
for (const a of SENSOR_AREAS) {
  const key = a.name.startsWith('C') ? 'C' : a.name
  SENSOR_BY_NAME.set(key, [...(SENSOR_BY_NAME.get(key) ?? []), a])
}
/** How long a judge step takes to fade once the star has passed it. */
const JUDGE_FADE_SEC = 0.15
const JUDGE_COLORS = {
  step: 'rgba(90, 170, 255, 0.35)',
  must: 'rgba(255, 160, 40, 0.6)',
  last: 'rgba(255, 255, 255, 0.85)',
}
/** Step numbers of the slides on screen, told apart by colour. */
const JUDGE_LABEL_COLORS = ['#ffffff', '#8ff0ff', '#ffb3e6', '#c8ff8a']

/** Width of the white edges along every note band. */
const EDGE = 0.035
/** Inside of notes. */
const HOLLOW = 'rgba(0, 0, 0, 0.8)'

/** `color` mixed with white by `t` (0..1); colours that are not #rrggbb come back as they are. */
function lighten(color: string, t: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1]!, 16)
  const mix = (c: number) => Math.round(c + (255 - c) * t)
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`
}

/** The red, green and blue of a #rgb, #rrggbb or rgb()/rgba() colour, or null for anything else. */
function rgbOf(color: string): [number, number, number] | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color)
  if (short) return [1, 2, 3].map((i) => parseInt(short[i]! + short[i]!, 16)) as [number, number, number]
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return [n >> 16, (n >> 8) & 255, n & 255]
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color)
  return fn ? [+fn[1]!, +fn[2]!, +fn[3]!] : null
}

/** How long a sensor stays lit after its touch ends. */
const SENSOR_LIT_SEC = 0.15

export const COLORS = {
  background: '#0d1017',
  field: '#000000',
  ring: '#e8ecf4',
  sensor: '#ffffff',
  label: '#7b86a3',
  tap: '#ff5fa2',
  star: '#22d3ff',
  each: '#ffcf33',
  break: '#ff8a1f',
  mine: '#7d6a8c',
  touch: '#33b5ff',
  /** Touch hold quarters: top left, top right, bottom left, bottom right. */
  touchHold: ['#3fa9ff', '#ff5a6e', '#4fd37a', '#ffd23f'],
  firework: ['#ffd23f', '#ff6fb5', '#6fd3ff', '#ffffff'],
  inner: '#ffffff',
  hit: '#ffffff',
}

/** A note with its time converted to audio time, plus what we need per frame. */
interface PreparedNote {
  note: Note
  /** Audio time of the hit. */
  time: number
  /** Audio time when everything about the note (hold tail, effects) is done. */
  end: number
  /** How fast a star head turns, radians per second (negative is clockwise). */
  spin: number
}

interface EachGroup {
  time: number
  positions: number[]
  hspeed: number
}

export interface PreparedChart {
  notes: PreparedNote[]
  eachGroups: EachGroup[]
  slides: PreparedSlide[]
}

/** Shift a parsed chart to audio time (`first` seconds of lead-in). */
export function prepareChart(chart: Chart, first: number): PreparedChart {
  const notes = chart.notes.map((note) => ({
    note,
    time: note.time + first,
    end: noteEndTime(note) + first + HIT_EFFECT_SEC,
    // a $$ tap spins at MajdataPlay's 440°/s; a slide's star takes its first slide's speed below
    spin: note.head === 'spinStar' ? (-440 * Math.PI) / 180 : 0,
  }))
  const byTime = new Map<number, { positions: number[]; hspeed: number }>()
  for (const { note, time } of notes) {
    if (!note.isEach || note.location.group !== 'button') continue
    const key = Math.round(time * 1e6)
    const group = byTime.get(key) ?? { positions: [], hspeed: note.hspeed }
    group.positions.push(note.location.index)
    byTime.set(key, group)
  }
  const eachGroups = [...byTime.entries()].map(([key, g]) => ({
    time: key / 1e6,
    positions: [...new Set(g.positions)].sort((a, b) => a - b),
    hspeed: g.hspeed,
  }))
  const slides = prepareSlides(notes)
  const firstSlide = new Map<Note, PreparedSlide>()
  for (const s of slides) if (!firstSlide.has(s.note)) firstSlide.set(s.note, s)
  for (const p of notes) {
    const s = firstSlide.get(p.note)
    if (s) p.spin = s.spin
  }
  return { notes, eachGroups, slides }
}

export interface RenderOptions {
  /** World units per second, from noteSpeedFromSetting(). */
  speed: number
  /** In-game touch speed setting; touches get their timing from it times hi-speed. */
  touchSpeed: number
  /** Draw the firework burst of touches marked `f`. */
  fireworks: boolean
  /** Colours chosen for particular notes, by noteKey(); they replace the usual colours. */
  noteColors?: ReadonlyMap<string, string> | null
  /** Outline the touch sensors (A1..E8, C) and light up the ones being touched. */
  showSensors?: boolean
  /** Shade the sensors each slide is judged on, numbered in order. */
  showSlideJudge?: boolean
  /** With showSlideJudge, draw the steps that must be touched in orange instead of blue. */
  showMustTouch?: boolean
}

/** Where a note was drawn in the last frame, in world units, for hit testing. */
interface Hit {
  key: string
  x: number
  y: number
  r: number
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  /** Pixels per world unit. */
  private k = 1
  private colors: ReadonlyMap<string, string> | null = null
  private hits: Hit[] = []
  private keys = new WeakMap<Note, string>()
  private guides = new Map<string, CanvasGradient | string>()

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d not supported')
    this.ctx = ctx
  }

  /** Match the backing store to the element size; returns true if it changed. */
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1
    const size = Math.round(Math.min(this.canvas.clientWidth, this.canvas.clientHeight) * dpr)
    if (size <= 0 || (this.canvas.width === size && this.canvas.height === size)) return false
    this.canvas.width = size
    this.canvas.height = size
    return true
  }

  render(chart: PreparedChart | null, now: number, opts: RenderOptions) {
    const { ctx, canvas } = this
    const size = canvas.width
    this.k = size / 2 / VIEW_RADIUS
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, size, size)
    // world space: origin at centre, y up, 1 unit = 1 world unit
    ctx.setTransform(this.k, 0, 0, -this.k, size / 2, size / 2)
    this.drawField()
    if (opts.showSensors) this.drawSensors(chart, now)
    if (opts.showSlideJudge && chart) this.drawSlideJudge(chart, now, opts.speed, opts.showMustTouch ?? false)
    this.hits = []
    this.colors = opts.noteColors ?? null
    if (!chart) return

    // slide tracks under everything else, later slides underneath
    for (let i = chart.slides.length - 1; i >= 0; i--) {
      const s = chart.slides[i]!
      if (now > s.endTime) continue
      const alpha = trackAlpha(s, now, Math.abs(opts.speed * s.note.hspeed))
      if (alpha > 0) this.drawSlideTrack(s, now, alpha)
    }
    this.drawEachLines(chart, now, opts.speed)
    for (let i = chart.notes.length - 1; i >= 0; i--) {
      const p = chart.notes[i]!
      if (p.note.location.group !== 'button' || p.note.head === 'none') continue
      const speed = opts.speed * p.note.hspeed
      if (p.time - appearLead(speed) > now || p.end < now) continue
      this.drawGuide(p, now, speed)
    }

    // later notes underneath, earlier ones on top
    for (let i = chart.notes.length - 1; i >= 0; i--) {
      const p = chart.notes[i]!
      const speed = opts.speed * p.note.hspeed
      if (p.time - appearLead(speed) > now || p.end < now) continue
      if (p.note.location.group !== 'button') continue // touches are drawn below
      if (p.note.head === 'none') continue // slide without a star tap
      if (p.note.kind === 'hold') this.drawHold(p, now, speed)
      else this.drawTap(p, now, speed)
    }
    for (let i = chart.slides.length - 1; i >= 0; i--) {
      const s = chart.slides[i]!
      if (now >= s.tapTime && now <= s.endTime) this.drawSlideStars(s, now)
      else if (now > s.endTime) this.drawSlideEnd(s, now)
    }
    for (const p of chart.notes) {
      if (p.note.location.group !== 'button' || p.note.head === 'none') continue
      if (now < p.time || p.end < now) continue
      this.drawHitEffect(p, now)
    }
    // touches on top of everything on the ring, later ones underneath
    for (let i = chart.notes.length - 1; i >= 0; i--) {
      const p = chart.notes[i]!
      if (p.note.location.group === 'button') continue
      const timing = touchTiming(opts.touchSpeed * Math.abs(p.note.hspeed))
      if (p.time - timing.whole > now || p.end < now) continue
      this.drawTouch(p, now, timing)
    }
    if (opts.fireworks) {
      for (const p of chart.notes) {
        if (!p.note.isFirework || p.note.location.group === 'button') continue
        const t = (now - (p.time + p.note.length)) / FIREWORK_SEC
        if (t >= 0 && t <= 1) this.drawFirework(p, t)
      }
    }
  }

  private drawField() {
    const { ctx } = this
    ctx.fillStyle = COLORS.field
    ctx.beginPath()
    ctx.arc(0, 0, JUDGE_RADIUS + 0.45, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = COLORS.ring
    ctx.lineWidth = 0.05
    ctx.beginPath()
    ctx.arc(0, 0, JUDGE_RADIUS, 0, Math.PI * 2)
    ctx.stroke()

    for (let b = 1; b <= 8; b++) {
      const p = buttonPoint(b, JUDGE_RADIUS)
      ctx.fillStyle = COLORS.sensor
      ctx.beginPath()
      ctx.arc(p.x, p.y, 0.13, 0, Math.PI * 2)
      ctx.fill()

      const l = buttonPoint(b, JUDGE_RADIUS + 0.75)
      ctx.save()
      ctx.translate(l.x, l.y)
      ctx.scale(1, -1)
      ctx.fillStyle = COLORS.label
      ctx.font = '0.32px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(b), 0, 0)
      ctx.restore()
    }
  }

  /** The touch sensor overlay: faint white areas, green while a touch on it is being hit. */
  private drawSensors(chart: PreparedChart | null, now: number) {
    const { ctx } = this
    const active = new Set<string>()
    for (const p of chart?.notes ?? []) {
      const loc = p.note.location
      if (loc.group === 'button' || now < p.time || now > p.end + SENSOR_LIT_SEC) continue
      for (const name of sensorNames(loc.group, loc.index)) active.add(name)
    }
    ctx.font = '0.24px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const area of SENSOR_AREAS) {
      const lit = active.has(area.name)
      ctx.beginPath()
      area.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      ctx.fillStyle = lit ? 'rgba(80, 230, 120, 0.45)' : 'rgba(255, 255, 255, 0.1)'
      ctx.fill()
      ctx.save()
      ctx.translate(area.centre.x, area.centre.y)
      ctx.scale(1, -1)
      ctx.fillStyle = lit ? '#e6ffec' : 'rgba(255, 255, 255, 0.6)'
      ctx.fillText(area.name, 0, 0)
      ctx.restore()
    }
  }

  /**
   * Each visible slide's judge queue on the sensors in blue, with the steps that must be touched
   * in orange when `must` is on; the last step is outlined. Steps fade out once the star has
   * passed them.
   */
  private drawSlideJudge(chart: PreparedChart, now: number, speed: number, must: boolean) {
    const { ctx } = this
    const marks = new Map<SensorArea, { fill: string; alpha: number; last: boolean; order: number; slide: number }[]>()
    let slide = 0
    for (const s of chart.slides) {
      if (s.judge.length === 0 || now > s.endTime + JUDGE_FADE_SEC) continue
      const shown = trackAlpha(s, now, Math.abs(speed * s.note.hspeed))
      if (shown <= 0) continue
      slide++
      for (const step of s.judge) {
        const passAt = s.startTime + (s.endTime - s.startTime) * step.at
        const alpha = shown * Math.min(1, Math.max(0, 1 - (now - passAt) / JUDGE_FADE_SEC))
        if (alpha <= 0) continue
        for (const name of step.sensors) {
          for (const area of SENSOR_BY_NAME.get(name) ?? []) {
            const list = marks.get(area) ?? []
            if (!marks.has(area)) marks.set(area, list)
            list.push({ fill: must && !step.skippable ? JUDGE_COLORS.must : JUDGE_COLORS.step, alpha, last: step.last, order: step.order, slide })
          }
        }
      }
    }
    ctx.lineWidth = 0.05
    ctx.lineJoin = 'round'
    ctx.font = 'bold 0.26px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [area, list] of marks) {
      ctx.beginPath()
      area.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      let top = 0
      // one line of numbers per slide, each slide in its own colour
      const lines = new Map<number, Set<number>>()
      for (const m of list) {
        ctx.globalAlpha = m.alpha
        ctx.fillStyle = m.fill
        ctx.fill()
        if (m.last) {
          ctx.strokeStyle = JUDGE_COLORS.last
          ctx.stroke()
        }
        top = Math.max(top, m.alpha)
        const line = lines.get(m.slide) ?? new Set<number>()
        lines.set(m.slide, line.add(m.order))
      }
      ctx.globalAlpha = top
      ctx.save()
      ctx.translate(area.centre.x, area.centre.y)
      ctx.scale(1, -1)
      const rows = [...lines].sort((a, b) => a[0] - b[0])
      rows.forEach(([slide, orders], i) => {
        ctx.fillStyle = JUDGE_LABEL_COLORS[(slide - 1) % JUDGE_LABEL_COLORS.length]!
        ctx.fillText([...orders].sort((a, b) => a - b).join('·'), 0, (i - (rows.length - 1) / 2) * 0.3)
      })
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  private keyOf(note: Note): string {
    let key = this.keys.get(note)
    if (!key) {
      key = noteKey(note)
      this.keys.set(note, key)
    }
    return key
  }

  /** The colour the author picked for this note, if any. */
  private custom(note: Note): string | undefined {
    return this.colors?.get(this.keyOf(note))
  }

  private hit(note: Note, x: number, y: number, r: number) {
    this.hits.push({ key: this.keyOf(note), x, y, r })
  }

  /** The note drawn nearest to a point on the canvas (fractions 0..1 of its size), if any. */
  hitTest(fx: number, fy: number): string | null {
    const x = (fx - 0.5) * 2 * VIEW_RADIUS
    const y = -(fy - 0.5) * 2 * VIEW_RADIUS
    let best: Hit | null = null
    let bestD = Infinity
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y)
      if (d <= h.r + 0.25 && d < bestD) {
        best = h
        bestD = d
      }
    }
    return best?.key ?? null
  }

  /** Notes drawn inside a rectangle given in canvas fractions. */
  notesIn(fx1: number, fy1: number, fx2: number, fy2: number): string[] {
    const [x1, x2] = [fx1, fx2].map((f) => (f - 0.5) * 2 * VIEW_RADIUS).sort((a, b) => a - b) as [number, number]
    const [y1, y2] = [fy1, fy2].map((f) => -(f - 0.5) * 2 * VIEW_RADIUS).sort((a, b) => a - b) as [number, number]
    return [...new Set(this.hits.filter((h) => h.x >= x1 && h.x <= x2 && h.y >= y1 && h.y <= y2).map((h) => h.key))]
  }

  private noteColor(note: Note, star: boolean): string {
    const custom = this.custom(note)
    if (custom) return custom
    if (note.isMine) return COLORS.mine
    if (note.isBreak) return COLORS.break
    if (note.isEach) return COLORS.each
    return star ? COLORS.star : COLORS.tap
  }

  private isStar(note: Note): boolean {
    if (note.head === 'star' || note.head === 'spinStar') return true
    if (note.head === 'tap') return false
    return note.slides.length > 0
  }

  /** Rotate the context so +x points outward along the note's lane. */
  private enterLane(position: number) {
    this.ctx.save()
    this.ctx.rotate(buttonAngle(position))
  }

  private applyExGlow(note: Note) {
    if (!note.isEx) return
    this.ctx.shadowColor = COLORS.inner
    this.ctx.shadowBlur = 0.35 * this.k
  }

  private drawTap(p: PreparedNote, now: number, speed: number) {
    if (now > p.time) return
    const state = tapState(now - p.time, speed)
    if (!state) return
    const { ctx } = this
    const { note } = p
    const star = this.isStar(note)
    const at = buttonPoint(note.location.index, state.distance)
    this.hit(note, at.x, at.y, NOTE_RADIUS * state.scale)
    this.enterLane(note.location.index)
    ctx.translate(state.distance, 0)
    ctx.scale(state.scale, state.scale)
    this.applyExGlow(note)
    const color = this.noteColor(note, star)
    if (star) {
      // it turns from the moment it appears, as in MajdataPlay's TapDrop
      ctx.rotate(p.spin * (now - (p.time - appearLead(speed))))
      this.drawStarShape(color)
    } else {
      this.drawTapRing(color, note.isEach && !note.isBreak && !note.isMine)
    }
    ctx.restore()
  }

  /** Stroke the current path as a band of `color` with thin white edges on both sides. */
  private band(color: string, width: number, edge = EDGE) {
    const { ctx } = this
    ctx.lineJoin = 'round'
    ctx.strokeStyle = COLORS.inner
    ctx.lineWidth = width + edge * 2
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
  }

  /** A tap at the origin: a thick ring with two light highlights, hollow, with a centre dot. */
  private drawTapRing(color: string, each: boolean) {
    const { ctx } = this
    const r = NOTE_RADIUS - 0.14
    const w = 0.21
    if (each) {
      // each notes carry a soft halo
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
      ctx.lineWidth = 0.1
      ctx.beginPath()
      ctx.arc(0, 0, r + w / 2 + 0.1, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fillStyle = HOLLOW
    ctx.fill()
    this.band(color, w)
    ctx.strokeStyle = lighten(color, 0.45)
    ctx.lineWidth = w * 0.6
    for (const start of [Math.PI * 0.15, Math.PI * 1.15]) {
      ctx.beginPath()
      ctx.arc(0, 0, r, start, start + Math.PI * 0.45)
      ctx.stroke()
    }
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(0, 0, 0.09, 0, Math.PI * 2)
    ctx.fill()
  }

  /** A star at the origin, pointing along +x. */
  private drawStarShape(color: string) {
    const { ctx } = this
    this.starPath(NOTE_RADIUS * 1.05, NOTE_RADIUS * 0.47)
    ctx.fillStyle = HOLLOW
    ctx.fill()
    this.band(color, 0.15)
  }

  private starPath(outer: number, inner: number) {
    const { ctx } = this
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      // first point faces outward along the lane
      const a = (i * Math.PI) / 5
      const r = i % 2 === 0 ? outer : inner
      if (i === 0) ctx.moveTo(r * Math.cos(a), r * Math.sin(a))
      else ctx.lineTo(r * Math.cos(a), r * Math.sin(a))
    }
    ctx.closePath()
  }

  private slideColor(s: PreparedSlide): string {
    const custom = this.custom(s.note)
    if (custom) return custom
    if (s.note.isMine) return COLORS.mine
    if (s.slide.isBreak) return COLORS.break
    if (s.isEach) return COLORS.each
    return COLORS.star
  }

  /** How far (0..1) the star has gone through `part`; 0 before the slide starts. */
  private partProgress(s: PreparedSlide, part: { t0: number; t1: number }, now: number): number {
    if (now < s.startTime) return 0
    const p = slideProgress(s, now)
    if (part.t1 <= part.t0) return p >= part.t1 ? 1 : 0
    return Math.min(Math.max((p - part.t0) / (part.t1 - part.t0), 0), 1)
  }

  private drawSlideTrack(s: PreparedSlide, now: number, alpha: number) {
    const { ctx } = this
    const color = this.slideColor(s)
    ctx.globalAlpha = alpha
    for (const part of s.parts) {
      const local = this.partProgress(s, part, now)
      if (local >= 1) continue
      if (part.kind === 'path') this.drawArrows(part, local, color)
      else this.drawWifiBars(part, local, color)
    }
    ctx.globalAlpha = 1
  }

  /** Chevron arrows along a path; the ones the star has passed are gone. */
  private drawArrows(part: PathPart, local: number, color: string) {
    const { ctx } = this
    const passed = local * (part.arrows.length - 1)
    ctx.fillStyle = color
    for (let i = part.first; i < part.last; i++) {
      if (local > 0 && i <= passed) continue
      const a = part.arrows[i]!
      ctx.save()
      ctx.translate(a.point.x, a.point.y)
      ctx.rotate(Math.atan2(a.direction.y, a.direction.x))
      ctx.beginPath()
      ctx.moveTo(0.19, 0)
      ctx.lineTo(-0.11, 0.34)
      ctx.lineTo(-0.28, 0.34)
      ctx.lineTo(0.02, 0)
      ctx.lineTo(-0.28, -0.34)
      ctx.lineTo(-0.11, -0.34)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  /**
   * Wifi: each bar is the outline "end+1 -> end -> end-1" of the ring, shrunk towards the
   * start button by a fixed factor (fitted to MajdataPlay's wifi prefab and sprites).
   */
  private drawWifiBars(part: WifiPart, local: number, color: string) {
    const { ctx } = this
    const { start } = part
    const toward = (p: { x: number; y: number }, f: number) => ({
      x: start.x + (p.x - start.x) * f,
      y: start.y + (p.y - start.y) * f,
    })
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const f of WIFI_BAR_SCALES) {
      if (local > 0 && f <= local) continue
      const [a, b, c] = part.ends.map((p) => toward(p, f)) as [Vec2, Vec2, Vec2]
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(c.x, c.y)
      ctx.strokeStyle = color
      ctx.lineWidth = 0.14
      ctx.stroke()
      ctx.strokeStyle = COLORS.inner
      ctx.lineWidth = 0.04
      ctx.stroke()
    }
  }

  private drawSlideStars(s: PreparedSlide, now: number) {
    const color = this.slideColor(s)
    const first = s.parts[0]!
    if (now < s.startTime) {
      // the star fades and grows in between the tap and the start of the slide
      if (s.note.head === 'none') return
      const wait = s.startTime - s.tapTime
      const alpha = wait > 0 ? Math.min(Math.max(1 - (s.startTime - now) / wait, 0), 1) : 1
      const scale = (alpha + 0.5) / 1.5
      if (first.kind === 'path') {
        const { point, angle } = starOnPath(first, 0)
        this.drawStarAt(point.x, point.y, angle, scale, alpha, color)
      } else {
        // the three wifi stars sit on top of each other until they split
        const centre = first.ends[1]
        const angle = Math.atan2(centre.y - first.start.y, centre.x - first.start.x)
        this.drawStarAt(first.start.x, first.start.y, angle, scale, alpha, color)
      }
      return
    }
    const p = slideProgress(s, now)
    const part = s.parts.find((x) => p <= x.t1) ?? s.parts[s.parts.length - 1]!
    const local = this.partProgress(s, part, now)
    if (part.kind === 'path') {
      const { point, angle } = starOnPath(part, local)
      this.hit(s.note, point.x, point.y, NOTE_RADIUS)
      this.drawStarAt(point.x, point.y, angle, 1, 1, color)
    } else {
      for (const end of part.ends) {
        const angle = Math.atan2(end.y - part.start.y, end.x - part.start.x)
        const x = part.start.x + (end.x - part.start.x) * local
        const y = part.start.y + (end.y - part.start.y) * local
        this.drawStarAt(x, y, angle, 1, 1, color)
      }
    }
  }

  private drawStarAt(x: number, y: number, angle: number, scale: number, alpha: number, color: string) {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.scale(scale, scale)
    this.drawStarShape(color)
    ctx.restore()
  }

  private touchColor(note: Note): string {
    const custom = this.custom(note)
    if (custom) return custom
    if (note.isMine) return COLORS.mine
    if (note.isBreak) return COLORS.break
    if (note.isEach) return COLORS.each
    return COLORS.touch
  }

  /** Touch: four pieces close in on the sensor; touch holds then fill a ring. */
  private drawTouch(p: PreparedNote, now: number, timing: TouchTiming) {
    const { ctx } = this
    const { note } = p
    const pos = touchPosition(note.location)
    const holdEnd = p.time + note.length
    if (now > holdEnd) {
      const t = (now - holdEnd) / HIT_EFFECT_SEC
      if (t > 1) return
      // a break touch's effect is the same as any other's
      this.drawHexBurst(pos.x, pos.y, t, EFFECT_COLORS[AUTOPLAY_JUDGEMENT].touch)
      return
    }
    const state = touchState(now - p.time, timing)
    if (!state) return
    this.hit(note, pos.x, pos.y, 0.65)
    const isHold = note.kind === 'touchHold'
    const plain = note.isBreak || note.isMine
    const color = this.touchColor(note)

    ctx.save()
    // touches are never rotated: pieces always point up, right, down and left on screen
    ctx.translate(pos.x, pos.y)
    ctx.globalAlpha = state.alpha

    if (isHold && now >= p.time && note.length > 0) {
      // progress ring, filling clockwise from the top
      const progress = Math.min((now - p.time) / note.length, 1)
      ctx.lineWidth = 0.1
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.beginPath()
      ctx.arc(0, 0, 0.82, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = plain ? color : COLORS.touchHold[0]!
      ctx.beginPath()
      ctx.arc(0, 0, 0.82, Math.PI / 2, Math.PI / 2 - progress * Math.PI * 2, true)
      ctx.stroke()
    }

    const r = TOUCH_PIECE_BASE + state.spread
    if (isHold && !plain) {
      // four quarters of a diamond, each in its own colour, closing in on the centre
      const d = 0.6
      const gap = 0.03 + state.spread * 0.7
      COLORS.touchHold.forEach((c, i) => {
        const sx = i % 2 === 0 ? -1 : 1
        const sy = i < 2 ? 1 : -1
        const ox = sx * gap
        const oy = sy * gap
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(ox + sx * d, oy)
        ctx.lineTo(ox, oy + sy * d)
        ctx.closePath()
        ctx.fillStyle = c
        ctx.fill()
        ctx.strokeStyle = COLORS.inner
        ctx.lineWidth = 0.04
        ctx.lineJoin = 'round'
        ctx.stroke()
      })
    } else {
      for (let i = 0; i < 4; i++) {
        // piece i sits up, right, down, left of the centre and points inward
        const a = (i * Math.PI) / 2
        const dx = Math.sin(a)
        const dy = Math.cos(a)
        ctx.beginPath()
        ctx.moveTo(dx * (r - 0.1), dy * (r - 0.1))
        ctx.lineTo(dx * (r + 0.26) - dy * 0.32, dy * (r + 0.26) + dx * 0.32)
        ctx.lineTo(dx * (r + 0.26) + dy * 0.32, dy * (r + 0.26) - dx * 0.32)
        ctx.closePath()
        ctx.fillStyle = HOLLOW
        ctx.fill()
        this.band(color, 0.1, 0.03)
      }
    }
    ctx.fillStyle = isHold && !plain ? COLORS.inner : color
    ctx.beginPath()
    ctx.arc(0, 0, 0.08, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /** Firework burst for touches marked `f`; t goes 0..1 over FIREWORK_SEC. */
  private drawFirework(p: PreparedNote, t: number) {
    const { ctx } = this
    const pos = touchPosition(p.note.location)
    const ease = 1 - Math.pow(1 - t, 3)
    const fade = 1 - t
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    // rings
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = COLORS.firework[k]!
      ctx.globalAlpha = fade * 0.6
      ctx.lineWidth = 0.08
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, ease * (2 + k * 1.3), 0, Math.PI * 2)
      ctx.stroke()
    }
    // sparks flying outward
    const sparks = 24
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2
      const outer = ease * (3.2 + (i % 3) * 0.8)
      const inner = Math.max(outer - 0.6, 0)
      ctx.strokeStyle = COLORS.firework[i % COLORS.firework.length]!
      ctx.globalAlpha = fade
      ctx.lineWidth = 0.07
      ctx.beginPath()
      ctx.moveTo(pos.x + Math.cos(a) * inner, pos.y + Math.sin(a) * inner)
      ctx.lineTo(pos.x + Math.cos(a) * outer, pos.y + Math.sin(a) * outer)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawHold(p: PreparedNote, now: number, speed: number) {
    const { note } = p
    const state = holdState(now - p.time, note.length, speed)
    if (!state) return
    const { ctx } = this
    // a regular hexagon around each end, stretched along the lane by the hold's length:
    // when it first appears (no length yet) it is a hexagon the size of a tap
    const r = (NOTE_RADIUS - 0.1) * state.scale
    const half = r / 2
    const w = r * (Math.sqrt(3) / 2)
    for (const d of [state.head, (state.head + state.tail) / 2, state.tail]) {
      const at = buttonPoint(note.location.index, d)
      this.hit(note, at.x, at.y, NOTE_RADIUS * state.scale)
    }
    this.enterLane(note.location.index)
    this.applyExGlow(note)
    const color = this.noteColor(note, false)
    const corners: [number, number][] = [
      [state.tail - r, 0],
      [state.tail - half, w],
      [state.head + half, w],
      [state.head + r, 0],
      [state.head + half, -w],
      [state.tail - half, -w],
    ]
    const outline = (grow: number) => {
      ctx.beginPath()
      corners.forEach(([x, y], i) => {
        // pushing every side out by `grow` moves the end corners 2/√3 and the others 1/√3 sideways
        const gx = x + Math.sign(x - (state.head + state.tail) / 2) * grow * (y === 0 ? 2 : 1) / Math.sqrt(3)
        const gy = y + Math.sign(y) * grow
        if (i === 0) ctx.moveTo(gx, gy)
        else ctx.lineTo(gx, gy)
      })
      ctx.closePath()
    }
    if (note.isEach && !note.isBreak && !note.isMine) {
      // each notes carry a soft halo, as taps do
      outline(0.21 * state.scale)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
      ctx.lineWidth = 0.1 * state.scale
      ctx.stroke()
    }
    outline(0)
    ctx.fillStyle = HOLLOW
    ctx.fill()
    if (now >= p.time) {
      // a held note lights up inside
      ctx.globalAlpha = 0.18
      ctx.fillStyle = color
      ctx.fill()
      ctx.globalAlpha = 1
    }
    this.band(color, 0.2 * state.scale, EDGE * state.scale)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(state.head, 0, 0.09 * state.scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawEachLines(chart: PreparedChart, now: number, baseSpeed: number) {
    const { ctx } = this
    for (const g of chart.eachGroups) {
      const speed = baseSpeed * g.hspeed
      if (g.time - appearLead(speed) > now || g.time < now) continue
      const state = tapState(now - g.time, speed)
      if (!state || state.scale < 0.3) continue
      ctx.strokeStyle = COLORS.each
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 0.09 * state.scale
      for (let i = 0; i + 1 < g.positions.length; i++) {
        this.arcBetween(g.positions[i]!, g.positions[i + 1]!, state.distance)
      }
      ctx.globalAlpha = 1
    }
  }

  /**
   * The guide ring of a tap, star or hold head. It sits on the spawn circle while the note
   * grows, then passes through the note; a hold's stays on the judge ring until it ends.
   */
  private drawGuide(p: PreparedNote, now: number, speed: number) {
    const { note } = p
    let radius: number
    if (note.kind === 'hold') {
      if (now > p.time + note.length) return
      const state = holdState(now - p.time, note.length, speed)
      if (!state || state.scale <= GUIDE_MIN_SCALE) return
      radius = state.head
    } else {
      if (now > p.time) return
      const state = tapState(now - p.time, speed)
      if (!state || state.scale <= GUIDE_MIN_SCALE) return
      radius = Math.abs(state.distance)
    }
    const { ctx } = this
    this.enterLane(note.location.index)
    ctx.strokeStyle = this.guideStyle(this.guideColor(note))
    ctx.lineWidth = Math.max((GUIDE_WIDTH * radius) / JUDGE_RADIUS, 1 / this.k)
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  /** Mines take the colour they would have as a plain note, as in MajdataPlay. */
  private guideColor(note: Note): string {
    const custom = this.custom(note)
    if (custom) return custom
    if (note.isBreak) return COLORS.break
    if (note.isEach) return COLORS.each
    return note.kind !== 'hold' && this.isStar(note) ? COLORS.star : COLORS.tap
  }

  /** A conic gradient around the origin, opaque along +x; drawn inside {@link enterLane}. */
  private guideStyle(color: string): CanvasGradient | string {
    let style = this.guides.get(color)
    if (style) return style
    const rgb = rgbOf(color)
    if (!rgb || typeof this.ctx.createConicGradient !== 'function') {
      style = color
    } else {
      const g = this.ctx.createConicGradient(0, 0, 0)
      const [r, gr, b] = rgb
      for (const [deg, a] of GUIDE_FADE) {
        g.addColorStop(deg / 360, `rgba(${r}, ${gr}, ${b}, ${a})`)
        if (deg > 0 && deg < 180) g.addColorStop(1 - deg / 360, `rgba(${r}, ${gr}, ${b}, ${a})`)
      }
      g.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 1)`)
      style = g
    }
    this.guides.set(color, style)
    return style
  }

  /** Arc on circle `radius` from button a to button b, the short way round. */
  private arcBetween(a: number, b: number, radius: number) {
    let steps = (((b - a) % 8) + 8) % 8 // clockwise steps from a to b
    if (steps === 0) return
    const ctx = this.ctx
    const start = buttonAngle(a)
    // buttons go clockwise, i.e. decreasing angle
    const sweep = steps <= 4 ? -steps : 8 - steps
    ctx.beginPath()
    ctx.arc(0, 0, Math.max(radius, SPAWN_RADIUS), start, start + (sweep * Math.PI) / 4, sweep < 0)
    ctx.stroke()
  }

  private drawHitEffect(p: PreparedNote, now: number) {
    const { ctx } = this
    const { note } = p
    const holdEnd = p.time + (note.kind === 'hold' ? note.length : 0)
    const pt = buttonPoint(note.location.index, JUDGE_RADIUS)
    if (now <= holdEnd && note.kind === 'hold') {
      // pulsing glow while the hold is held
      const pulse = 0.5 + 0.5 * Math.sin(now * 20)
      ctx.fillStyle = EFFECT_COLORS[AUTOPLAY_JUDGEMENT].hold
      ctx.globalAlpha = 0.25 + 0.2 * pulse
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, NOTE_RADIUS * 1.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      return
    }
    const t = (now - holdEnd) / HIT_EFFECT_SEC
    if (t < 0 || t > 1) return
    const colors = EFFECT_COLORS[AUTOPLAY_JUDGEMENT]
    // breaks burst into stars instead of hexagons
    this.drawHexBurst(pt.x, pt.y, t, note.isBreak ? colors.break : colors.tap, note.isBreak)
  }

  /**
   * Hit effect: outlines growing out of a point and fading, a white core in a coloured glow
   * like MajdataPlay's effect sprites; hexagons, or stars for breaks. t goes 0..1.
   */
  private drawHexBurst(x: number, y: number, t: number, color: string, star = false) {
    const { ctx } = this
    const ease = 1 - Math.pow(1 - t, 2)
    const width = 0.07 * (1 - t) + 0.02
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.globalAlpha = 1 - t
    for (let k = 0; k < 3; k++) {
      const r = NOTE_RADIUS * (0.7 + ease * (0.7 + k * 0.35))
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(k * 0.35 + ease * 0.4)
      if (star) {
        this.starPath(r, r * 0.47)
      } else {
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3
          if (i === 0) ctx.moveTo(r * Math.cos(a), r * Math.sin(a))
          else ctx.lineTo(r * Math.cos(a), r * Math.sin(a))
        }
        ctx.closePath()
      }
      ctx.restore()
      ctx.strokeStyle = color
      ctx.lineWidth = width * 2.2
      ctx.stroke()
      ctx.strokeStyle = lighten(color, 0.75)
      ctx.lineWidth = width * 0.7
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Rays flying out of a point, where a break slide ends; t goes 0..1. */
  private drawBurst(x: number, y: number, t: number, color: string) {
    const { ctx } = this
    const ease = 1 - Math.pow(1 - t, 2)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = color
    ctx.globalAlpha = 1 - t
    ctx.lineWidth = 0.08
    ctx.lineCap = 'round'
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.2
      const outer = NOTE_RADIUS * (0.9 + ease * 1.6)
      const inner = NOTE_RADIUS * (0.6 + ease * 1.1)
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner)
      ctx.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Flash where a slide ends, once the star arrives. */
  private drawSlideEnd(s: PreparedSlide, now: number) {
    const t = (now - s.endTime) / SLIDE_END_SEC
    if (t < 0 || t > 1) return
    const last = s.parts[s.parts.length - 1]!
    const points = last.kind === 'path' ? [last.arrows[last.arrows.length - 1]!.point] : last.ends
    const { ctx } = this
    const color = this.slideColor(s)
    for (const pt of points) {
      ctx.globalAlpha = 1 - t
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, NOTE_RADIUS * (0.5 + t * 0.8), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = (1 - t) * 0.9
      ctx.strokeStyle = COLORS.hit
      ctx.lineWidth = 0.06
      ctx.stroke()
      if (s.slide.isBreak) this.drawBurst(pt.x, pt.y, t, COLORS.break)
    }
    ctx.globalAlpha = 1
  }
}
