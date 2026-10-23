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
} from '../core/geometry'
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

export const COLORS = {
  background: '#0d1017',
  field: '#151a24',
  ring: '#3a4256',
  sensor: '#566079',
  label: '#7b86a3',
  tap: '#ff5fa2',
  star: '#33b5ff',
  each: '#ffcf33',
  break: '#ff8a1f',
  mine: '#7d6a8c',
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
}

interface EachGroup {
  time: number
  positions: number[]
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
  }))
  const byTime = new Map<number, number[]>()
  for (const { note, time } of notes) {
    if (!note.isEach || note.location.group !== 'button') continue
    const key = Math.round(time * 1e6)
    const list = byTime.get(key) ?? []
    list.push(note.location.index)
    byTime.set(key, list)
  }
  const eachGroups = [...byTime.entries()].map(([key, positions]) => ({
    time: key / 1e6,
    positions: [...new Set(positions)].sort((a, b) => a - b),
  }))
  return { notes, eachGroups, slides: prepareSlides(notes) }
}

export interface RenderOptions {
  /** World units per second, from noteSpeedFromSetting(). */
  speed: number
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  /** Pixels per world unit. */
  private k = 1

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
    if (!chart) return

    const lead = appearLead(opts.speed)
    // slide tracks under everything else, later slides underneath
    for (let i = chart.slides.length - 1; i >= 0; i--) {
      const s = chart.slides[i]!
      if (now > s.endTime) continue
      const alpha = trackAlpha(s, now, opts.speed)
      if (alpha > 0) this.drawSlideTrack(s, now, alpha)
    }
    this.drawEachLines(chart, now, opts.speed, lead)

    // later notes underneath, earlier ones on top
    for (let i = chart.notes.length - 1; i >= 0; i--) {
      const p = chart.notes[i]!
      if (p.time - lead > now || p.end < now) continue
      if (p.note.location.group !== 'button') continue // touches: M3
      if (p.note.head === 'none') continue // slide without a star tap
      if (p.note.kind === 'hold') this.drawHold(p, now, opts.speed)
      else this.drawTap(p, now, opts.speed)
    }
    for (let i = chart.slides.length - 1; i >= 0; i--) {
      const s = chart.slides[i]!
      if (now >= s.tapTime && now <= s.endTime) this.drawSlideStars(s, now)
    }
    for (const p of chart.notes) {
      if (p.note.location.group !== 'button' || p.note.head === 'none') continue
      if (now < p.time || p.end < now) continue
      this.drawHitEffect(p, now)
    }
  }

  private drawField() {
    const { ctx } = this
    ctx.fillStyle = COLORS.field
    ctx.beginPath()
    ctx.arc(0, 0, JUDGE_RADIUS + 0.45, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = COLORS.ring
    ctx.lineWidth = 0.04
    ctx.beginPath()
    ctx.arc(0, 0, JUDGE_RADIUS, 0, Math.PI * 2)
    ctx.stroke()

    for (let b = 1; b <= 8; b++) {
      const p = buttonPoint(b, JUDGE_RADIUS)
      ctx.fillStyle = COLORS.sensor
      ctx.beginPath()
      ctx.arc(p.x, p.y, 0.1, 0, Math.PI * 2)
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

  private noteColor(note: Note, star: boolean): string {
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
    this.enterLane(note.location.index)
    ctx.translate(state.distance, 0)
    ctx.scale(state.scale, state.scale)
    this.applyExGlow(note)
    ctx.strokeStyle = this.noteColor(note, star)
    if (star) {
      if (note.head === 'spinStar') ctx.rotate(-now * Math.PI * 2)
      this.starPath(NOTE_RADIUS * 1.05, NOTE_RADIUS * 0.45)
      ctx.lineWidth = 0.17
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.strokeStyle = COLORS.inner
      ctx.lineWidth = 0.05
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, NOTE_RADIUS - 0.09, 0, Math.PI * 2)
      ctx.lineWidth = 0.18
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.strokeStyle = COLORS.inner
      ctx.lineWidth = 0.05
      ctx.stroke()
    }
    ctx.restore()
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
      ctx.moveTo(0.16, 0)
      ctx.lineTo(-0.1, 0.3)
      ctx.lineTo(-0.24, 0.3)
      ctx.lineTo(0.02, 0)
      ctx.lineTo(-0.24, -0.3)
      ctx.lineTo(-0.1, -0.3)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  /** Wifi: bars that widen from the start towards the three end buttons. */
  private drawWifiBars(part: WifiPart, local: number, color: string) {
    const { ctx } = this
    const [right, centre, left] = part.ends
    const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, f: number) => ({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
    })
    const dx = centre.x - part.start.x
    const dy = centre.y - part.start.y
    const len = Math.hypot(dx, dy)
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const bars = 12
    for (let j = 1; j <= bars; j++) {
      const f = j / (bars + 1)
      if (local > 0 && f <= local) continue
      const l = lerp(part.start, left, f)
      const r = lerp(part.start, right, f)
      // a slight chevron pointing the way the stars travel
      const bend = 0.12 + 0.18 * f
      ctx.lineWidth = 0.1 + 0.06 * f
      ctx.beginPath()
      ctx.moveTo(l.x, l.y)
      ctx.lineTo((l.x + r.x) / 2 + (dx / len) * bend, (l.y + r.y) / 2 + (dy / len) * bend)
      ctx.lineTo(r.x, r.y)
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
    this.starPath(NOTE_RADIUS * 1.05, NOTE_RADIUS * 0.45)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 0.17
    ctx.stroke()
    ctx.strokeStyle = COLORS.inner
    ctx.lineWidth = 0.05
    ctx.stroke()
    ctx.restore()
  }

  private drawHold(p: PreparedNote, now: number, speed: number) {
    const { note } = p
    const state = holdState(now - p.time, note.length, speed)
    if (!state) return
    const { ctx } = this
    const w = (NOTE_RADIUS - 0.09) * state.scale
    const tip = w * 0.75
    this.enterLane(note.location.index)
    this.applyExGlow(note)
    ctx.beginPath()
    ctx.moveTo(state.tail - tip, 0)
    ctx.lineTo(state.tail, w)
    ctx.lineTo(state.head, w)
    ctx.lineTo(state.head + tip, 0)
    ctx.lineTo(state.head, -w)
    ctx.lineTo(state.tail, -w)
    ctx.closePath()
    // a held note glows a little brighter
    ctx.fillStyle = now >= p.time ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.25)'
    ctx.fill()
    ctx.strokeStyle = this.noteColor(note, false)
    ctx.lineWidth = 0.18 * state.scale
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = COLORS.inner
    ctx.lineWidth = 0.05 * state.scale
    ctx.stroke()
    ctx.restore()
  }

  private drawEachLines(chart: PreparedChart, now: number, speed: number, lead: number) {
    const { ctx } = this
    for (const g of chart.eachGroups) {
      if (g.time - lead > now || g.time < now) continue
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
      ctx.fillStyle = this.noteColor(note, false)
      ctx.globalAlpha = 0.25 + 0.2 * pulse
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, NOTE_RADIUS * 1.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      return
    }
    const t = (now - holdEnd) / HIT_EFFECT_SEC
    if (t < 0 || t > 1) return
    ctx.strokeStyle = note.isBreak ? COLORS.break : COLORS.hit
    ctx.globalAlpha = 1 - t
    ctx.lineWidth = 0.12 * (1 - t) + 0.02
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, NOTE_RADIUS * (0.8 + t * 0.9), 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}
