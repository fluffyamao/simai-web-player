// SPDX-License-Identifier: GPL-3.0-only
//
// Parametric slide paths, ported from MajdataPlay (GPL-3.0):
//   Assets/Scripts/Scenes/Game/Misc/Parsing/SlideGeo.cs
//   Assets/Scripts/Scenes/Game/Misc/Parsing/SlideCodeParser.cs
//   Assets/Scripts/Scenes/Game/Misc/Parsing/SlideDataBuilder.cs        (BuildArrowData)
//   Assets/Scripts/Scenes/Game/Misc/Parsing/Slide/SlidePathConstructor.cs
//   Assets/Scripts/Scenes/Game/Misc/Parsing/Slide/ParametricSlidePath.cs
//   Assets/Scripts/Scenes/Game/Misc/Parsing/Slide/Segments/*.cs
// Complex numbers are {x, y}; angles are radians, 0 = right, counter-clockwise positive.
import type { Vec2 } from './geometry'

// ---------- complex helpers ----------

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
const mag = (a: Vec2) => Math.hypot(a.x, a.y)
const phase = (a: Vec2) => Math.atan2(a.y, a.x)
const polar = (r: number, theta: number): Vec2 => ({ x: r * Math.cos(theta), y: r * Math.sin(theta) })
/** Multiply by i (rotate 90° counter-clockwise). */
const mulI = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })
/** Math.IEEERemainder(x, 2π): wraps into [-π, π]. */
const wrap = (x: number) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI))

// ---------- SlideGeo ----------

interface Circle {
  center: Vec2
  radius: number
}

export const MAIN_RADIUS = 4.8
const EPSILON = 0.0001
const EPSILON_RAD = 0.002
const CENTER_RADIUS = MAIN_RADIUS * Math.cos((Math.PI * 3) / 8)
const GROUP_B_RADIUS = CENTER_RADIUS / Math.cos(Math.PI / 8)
const B_ = Math.cos(Math.PI / 8) / 2
const A_ = 1 - B_
const THETA = Math.PI / 4
const S_ = (A_ * A_ + B_ * B_ - 2 * A_ * B_ * Math.cos(THETA)) / (2 * A_ - 2 * B_ * Math.cos(THETA))
const PPQQ_RADIUS = MAIN_RADIUS * B_
const TRANSFER_RADIUS = MAIN_RADIUS * (B_ + S_)
const EDGE_TRANSFER_RADIAN = THETA
const PPQQ_TRANSFER_RADIAN = Math.acos((S_ * S_ + B_ * B_ - (A_ - S_) * (A_ - S_)) / (2 * B_ * S_))
/** Spacing between slide arrows. */
export const ARROW_DISTANCE = (MAIN_RADIUS * Math.PI) / 32

/** Button / A-sensor node, 1..8. */
export const pointA = (i: number) => polar(MAIN_RADIUS, Math.PI * (5 / 8 - i / 4))
/** B node (inner ring), 1..8. */
export const pointB = (i: number) => polar(GROUP_B_RADIUS, Math.PI * (5 / 8 - i / 4))

/** 0: centre circle (p/q), 1..8: pp/qq circles through D[i], 9: judge circle. */
function getCircle(i: number): Circle {
  if (i === 0) return { center: { x: 0, y: 0 }, radius: CENTER_RADIUS }
  if (i === 9) return { center: { x: 0, y: 0 }, radius: MAIN_RADIUS }
  return { center: polar(PPQQ_RADIUS, Math.PI * (3 / 4 - i / 4)), radius: PPQQ_RADIUS }
}

/** Angle on `circle` where a tangent from `point` touches it. */
function tangentAngle(point: Vec2, circle: Circle, ccw: boolean): number {
  const hypot = sub(point, circle.center)
  const delta = Math.acos(circle.radius / mag(hypot))
  return wrap(phase(hypot) + (ccw ? delta : -delta))
}

/** Transfer arc from pp/qq circle `i` out to the judge circle. */
function transferOutData(i: number, ccw: boolean): [Circle, number, number] {
  const ppqq = Math.PI * (3 / 4 - i / 4)
  const start = ccw ? ppqq - PPQQ_TRANSFER_RADIAN : ppqq + PPQQ_TRANSFER_RADIAN
  const end = ccw ? ppqq + EDGE_TRANSFER_RADIAN : ppqq - EDGE_TRANSFER_RADIAN
  const center = polar(MAIN_RADIUS - TRANSFER_RADIUS, end)
  return [{ center, radius: TRANSFER_RADIUS }, wrap(start), wrap(end)]
}

// ---------- segments ----------

type Marker = 'none' | 'smoothAlign' | 'forceAlign'

abstract class Segment {
  marker: Marker = 'none'
  arrowDistance = ARROW_DISTANCE
  abstract readonly isCurve: boolean
  abstract pointAt(t: number): Vec2
  abstract tangentAt(t: number): Vec2
  abstract length(): number
}

class LineSegment extends Segment {
  readonly isCurve = false
  constructor(readonly start: Vec2, readonly end: Vec2) {
    super()
  }
  pointAt(t: number) {
    return add(this.start, scale(sub(this.end, this.start), t))
  }
  tangentAt() {
    const v = sub(this.end, this.start)
    return scale(v, 1 / mag(v))
  }
  length() {
    return mag(sub(this.end, this.start))
  }
}

class ArcSegment extends Segment {
  readonly isCurve = true
  constructor(readonly circle: Circle, readonly startRad: number, readonly endRad: number) {
    super()
  }
  pointAt(t: number) {
    return add(this.circle.center, polar(this.circle.radius, this.startRad + t * (this.endRad - this.startRad)))
  }
  tangentAt(t: number) {
    const angle = this.startRad + t * (this.endRad - this.startRad)
    return this.startRad < this.endRad ? mulI(polar(1, angle)) : mulI(polar(-1, angle))
  }
  length() {
    return Math.abs(this.endRad - this.startRad) * this.circle.radius
  }
}

class CircleSegment extends Segment {
  readonly isCurve = true
  constructor(readonly circle: Circle, readonly startRad: number, readonly ccw: boolean) {
    super()
  }
  private angle(t: number) {
    return this.ccw ? this.startRad + t * Math.PI * 2 : this.startRad - t * Math.PI * 2
  }
  pointAt(t: number) {
    return add(this.circle.center, polar(this.circle.radius, this.angle(t)))
  }
  tangentAt(t: number) {
    return mulI(polar(this.ccw ? 1 : -1, this.angle(t)))
  }
  length() {
    return Math.PI * this.circle.radius * 2
  }
}

// ---------- path ----------

export class SlidePath {
  readonly accumulated: number[]
  readonly fractions: number[]

  constructor(readonly segments: Segment[]) {
    if (segments.length === 0) throw new Error('slide path needs at least one segment')
    let sum = 0
    this.accumulated = segments.map((s) => (sum += s.length()))
    this.fractions = this.accumulated.map((x) => x / sum)
  }

  get length() {
    return this.accumulated[this.accumulated.length - 1]!
  }

  segmentAt(t: number): [Segment, number] {
    const segs = this.segments
    if (t <= 0) return [segs[0]!, 0]
    if (t >= 1) return [segs[segs.length - 1]!, 1]
    let i = this.fractions.findIndex((f) => f >= t)
    if (i === -1) return [segs[segs.length - 1]!, 1]
    if (i === 0) return [segs[0]!, t / this.fractions[0]!]
    return [segs[i]!, (t - this.fractions[i - 1]!) / (this.fractions[i]! - this.fractions[i - 1]!)]
  }

  pointAt(t: number): Vec2 {
    const [s, u] = this.segmentAt(t)
    return s.pointAt(u)
  }

  tangentAt(t: number): Vec2 {
    const [s, u] = this.segmentAt(t)
    return s.tangentAt(u)
  }

  /** Does the path end on a circle going clockwise / counter-clockwise, or on a line? */
  endShape(): 'cw' | 'ccw' | 'straight' {
    const last = this.segments[this.segments.length - 1]!
    if (last instanceof CircleSegment) return last.ccw ? 'ccw' : 'cw'
    if (last instanceof ArcSegment) return last.endRad > last.startRad ? 'ccw' : 'cw'
    return 'straight'
  }
}

class PathBuilder {
  readonly segments: Segment[] = []
  constructor(public end: Vec2) {}

  setLastMarker(marker: Marker) {
    const last = this.segments[this.segments.length - 1]
    if (last) last.marker = marker
    return this
  }

  lineTo(point: Vec2) {
    this.segments.push(new LineSegment(this.end, point))
    this.end = point
    return this
  }

  tangentToCircle(circle: Circle, ccw: boolean) {
    const angle = tangentAngle(this.end, circle, ccw)
    return this.lineTo(add(polar(circle.radius, angle), circle.center))
  }

  arcToAngle(center: Vec2, endRad: number, ccw: boolean, skipIfZero: boolean) {
    const diff = sub(this.end, center)
    const circle = { center, radius: mag(diff) }
    let startRad = phase(diff)
    if (ccw) {
      if (Math.abs(endRad - startRad) < EPSILON_RAD) {
        if (skipIfZero) return this
        endRad += 2 * Math.PI
      }
      if (startRad > endRad) startRad -= 2 * Math.PI
    } else {
      if (Math.abs(endRad - startRad) < EPSILON_RAD) {
        if (skipIfZero) return this
        endRad -= 2 * Math.PI
      }
      if (startRad < endRad) startRad += 2 * Math.PI
    }
    const seg = new ArcSegment(circle, startRad, endRad)
    this.segments.push(seg)
    this.end = seg.pointAt(1)
    return this
  }

  arcToTangentTowards(target: Vec2, center: Vec2, ccw: boolean) {
    const radius = mag(sub(this.end, center))
    const endRad = tangentAngle(target, { center, radius }, !ccw)
    return this.arcToAngle(center, endRad, ccw, false)
  }

  fullCircle(center: Vec2, ccw: boolean) {
    const diff = sub(this.end, center)
    this.segments.push(new CircleSegment({ center, radius: mag(diff) }, phase(diff), ccw))
    return this
  }

  externTangentTransfer(currentCenter: Vec2, target: Circle, ccw: boolean) {
    const diff = sub(this.end, currentCenter)
    let endRad: number
    if (Math.abs(mag(diff) - target.radius) < EPSILON) {
      const v = sub(target.center, currentCenter)
      endRad = phase(ccw ? { x: v.y, y: -v.x } : mulI(v))
    } else if (target.radius > mag(diff)) {
      endRad = tangentAngle(currentCenter, { center: target.center, radius: target.radius - mag(diff) }, ccw)
    } else {
      endRad = tangentAngle(target.center, { center: currentCenter, radius: mag(diff) - target.radius }, !ccw)
    }
    this.arcToAngle(currentCenter, endRad, ccw, false)
    return this.lineTo(add(polar(target.radius, endRad), target.center))
  }
}

// ---------- slide code ----------
//
// A slide code describes a path as nodes and orbits, e.g. "1P3K5":
//   digit at start: start button (A node)
//   A n / B n / C: line to A node n, B node n, or the centre
//   P n / Q n: go around circle n counter-clockwise / clockwise (see getCircle)
//   K n: end at button n

type CommandType = 'A' | 'B' | 'C' | 'P' | 'Q' | 'K'
interface Command {
  type: CommandType
  value: number
}

function parseCommands(code: string): Command[] {
  const isCommand = (c: string) => 'ABCPQK'.includes(c)
  if (!isCommand(code[1] ?? '')) throw new Error(`slide code ${code}: 2nd char must be a command`)
  if (code[code.length - 2] !== 'K') throw new Error(`slide code ${code}: must end with K`)
  const commands: Command[] = [{ type: 'A', value: Number(code[0]) }]
  let type: CommandType = 'A'
  for (const ch of code.slice(1)) {
    if (isCommand(ch)) {
      type = ch as CommandType
      if (type === 'C') commands.push({ type: 'C', value: 0 })
    } else {
      const value = Number(ch)
      if (!(value >= 0 && value <= 9) || type === 'C') throw new Error(`slide code ${code}: bad char ${ch}`)
      commands.push({ type, value })
    }
  }
  return commands
}

const isOrbit = (c: Command) => c.type === 'P' || c.type === 'Q'

function nodePosition(c: Command): Vec2 {
  if (c.type === 'A' || c.type === 'K') return pointA(c.value)
  if (c.type === 'B') return pointB(c.value)
  return { x: 0, y: 0 }
}

export function pathFromSlideCode(code: string): SlidePath {
  const commands = parseCommands(code)
  let last = commands[0]!
  const b = new PathBuilder(pointA(last.value))
  for (const cmd of commands.slice(1)) {
    if (last.type === 'K') throw new Error(`slide code ${code}: K must be last`)
    if (!isOrbit(cmd)) {
      if (!isOrbit(last)) {
        // node -> node
        if (!(last.type === cmd.type && last.value === cmd.value)) b.lineTo(nodePosition(cmd))
      } else {
        // orbit -> node
        const ccw = last.type === 'P'
        const node = nodePosition(cmd)
        const orbit = getCircle(last.value)
        const diff = sub(node, orbit.center)
        if (Math.abs(mag(diff) - orbit.radius) < 0.1) {
          b.arcToAngle(orbit.center, phase(diff), ccw, false)
        } else {
          if (mag(diff) < orbit.radius) throw new Error(`slide code ${code}: impossible orbit exit`)
          b.arcToTangentTowards(node, orbit.center, ccw).lineTo(node)
        }
      }
    } else if (!isOrbit(last)) {
      // node -> orbit
      const ccw = cmd.type === 'P'
      const node = nodePosition(last)
      const orbit = getCircle(cmd.value)
      const diff = sub(node, orbit.center)
      if (Math.abs(mag(diff) - orbit.radius) < 0.1) {
        if (last.type === 'A' && cmd.value === 9) b.setLastMarker('forceAlign')
      } else {
        if (mag(diff) < orbit.radius) throw new Error(`slide code ${code}: impossible orbit entry`)
        b.tangentToCircle(orbit, ccw)
      }
    } else {
      // orbit -> orbit
      if (cmd.type !== last.type) throw new Error(`slide code ${code}: orbit direction mismatch`)
      const ccw = last.type === 'P'
      const lastOrbit = getCircle(last.value)
      const orbit = getCircle(cmd.value)
      if (cmd.value === last.value) {
        b.fullCircle(lastOrbit.center, ccw)
      } else if ((last.value === 0 && cmd.value === 9) || (last.value === 9 && cmd.value === 0)) {
        throw new Error(`slide code ${code}: impossible orbit transfer`)
      } else if (cmd.value === 9) {
        const [transfer, start, end] = transferOutData(last.value, ccw)
        b.arcToAngle(lastOrbit.center, start, ccw, false)
          .arcToAngle(transfer.center, end, ccw, false)
          .setLastMarker('smoothAlign')
      } else if (last.value === 9) {
        const [transfer, start, end] = transferOutData(cmd.value, !ccw)
        b.arcToAngle(lastOrbit.center, end, ccw, true).arcToAngle(transfer.center, start, ccw, false)
      } else {
        b.externTangentTransfer(lastOrbit.center, orbit, ccw)
      }
    }
    last = cmd
  }
  return new SlidePath(b.segments)
}

// ---------- arrows ----------

export interface Arrow {
  point: Vec2
  /** Unit vector the arrow points along. */
  direction: Vec2
  /** Distance along the path. */
  at: number
}

/**
 * Arrow positions along a path. Like MajdataPlay, the first and last entries are the
 * path's start and end, where no arrow is drawn.
 */
export function buildArrows(path: SlidePath): Arrow[] {
  // arrow spacing may be adjusted per segment, so work on copies of the defaults
  for (const s of path.segments) s.arrowDistance = ARROW_DISTANCE
  const result: Arrow[] = []
  const total = path.length
  const count = path.segments.length
  let current = 0
  let seg = 0
  while (current < total) {
    const t = current / total
    const point = path.pointAt(t)
    let direction = path.tangentAt(t)
    if (path.segmentAt(t)[0].isCurve && current > 0) {
      // on arcs the official game points each arrow from the previous one
      const d = sub(point, result[result.length - 1]!.point)
      direction = scale(d, 1 / mag(d))
    }
    result.push({ point, direction, at: current })

    let next = current + path.segments[seg]!.arrowDistance
    if (seg < count - 1 && next >= path.accumulated[seg]!) {
      const following = path.segments[seg + 1]!
      if (following.marker === 'smoothAlign') {
        // stretch the spacing so arrows land exactly on the end of the next segment
        const delta = path.accumulated[seg + 1]! - current
        const n = Math.round(delta / ARROW_DISTANCE)
        following.arrowDistance = delta / n
        next = current + delta / n
      }
      if (path.segments[seg]!.marker === 'forceAlign') {
        next = path.accumulated[seg]! + following.arrowDistance
      }
      seg++
    }
    current = next
  }
  result.push({ point: path.pointAt(1), direction: path.tangentAt(1), at: total })
  return result
}
