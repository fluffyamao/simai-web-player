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
  return { notes, eachGroups }
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
    this.drawEachLines(chart, now, opts.speed, lead)

    // later notes underneath, earlier ones on top
    for (let i = chart.notes.length - 1; i >= 0; i--) {
      const p = chart.notes[i]!
      if (p.time - lead > now || p.end < now) continue
      if (p.note.location.group !== 'button') continue // touches: M3
      if (p.note.head === 'none') continue // slide-only notes: M2
      if (p.note.kind === 'hold') this.drawHold(p, now, opts.speed)
      else this.drawTap(p, now, opts.speed)
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
