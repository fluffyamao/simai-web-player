// SPDX-License-Identifier: GPL-3.0-only
//
// Hit sounds, synthesised in code (no game samples), scheduled on Web Audio a little
// ahead of the playback clock so they land on time.
import type { Note } from '../parser/types'

export type HitSoundKind = 'tap' | 'break' | 'touch' | 'slide' | 'firework'

export interface HitSoundEvent {
  /** Audio time in seconds. */
  time: number
  kind: HitSoundKind
}

/** Seconds of audio scheduled ahead of the clock. */
const LOOKAHEAD = 0.15

/** Hit sound events for a chart, in audio time. One sound per kind per moment. */
export function hitSoundEvents(notes: { note: Note; time: number }[], fireworks: boolean): HitSoundEvent[] {
  const seen = new Set<string>()
  const events: HitSoundEvent[] = []
  const add = (time: number, kind: HitSoundKind) => {
    const key = `${Math.round(time * 1000)}:${kind}`
    if (seen.has(key)) return
    seen.add(key)
    events.push({ time, kind })
  }
  for (const { note, time } of notes) {
    if (note.isMine) continue
    if (note.location.group === 'button') {
      if (note.head !== 'none') add(time, note.isBreak ? 'break' : 'tap')
      for (const s of note.slides) add(time + s.delay, s.isBreak ? 'break' : 'slide')
    } else {
      add(time, note.isBreak ? 'break' : 'touch')
      if (note.isFirework && fireworks) add(time + note.length, 'firework')
    }
  }
  return events.sort((a, b) => a.time - b.time)
}

type Synth = (t: number, rand: () => number) => number

const decay = (t: number, rate: number) => Math.exp(-t * rate)
const SYNTHS: Record<HitSoundKind, [seconds: number, gain: number, fn: Synth]> = {
  // short bright click
  tap: [0.06, 0.6, (t, r) => Math.sin(2 * Math.PI * 1760 * t) * decay(t, 70) + (r() * 2 - 1) * decay(t, 400) * 0.5],
  // two-tone chime with a crack
  break: [
    0.35,
    0.55,
    (t, r) =>
      (Math.sin(2 * Math.PI * 1318 * t) + Math.sin(2 * Math.PI * 1976 * t) * 0.7) * decay(t, 12) +
      (r() * 2 - 1) * decay(t, 60) * 0.6,
  ],
  // soft pop
  touch: [0.08, 0.5, (t) => Math.sin(2 * Math.PI * (700 + 500 * decay(t, 40)) * t) * decay(t, 45)],
  // short airy swish
  slide: [0.3, 0.25, (t, r) => (r() * 2 - 1) * Math.sin(Math.PI * Math.min(t / 0.3, 1)) * 0.8],
  // crackling burst
  firework: [
    0.8,
    0.45,
    (t, r) => (r() * 2 - 1) * decay(t, 5) * (r() < 0.02 ? 3 : 0.5) + Math.sin(2 * Math.PI * 90 * t) * decay(t, 8),
  ],
}

function render(ctx: AudioContext, kind: HitSoundKind): AudioBuffer {
  const [seconds, gain, fn] = SYNTHS[kind]
  const rate = ctx.sampleRate
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * rate), rate)
  const data = buffer.getChannelData(0)
  let seed = 1234567
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < data.length; i++) {
    const t = i / rate
    // 2 ms fade-out at the end to avoid clicks
    const tail = Math.min(1, (seconds - t) / 0.002)
    data[i] = Math.max(-1, Math.min(1, fn(t, rand) * gain * tail))
  }
  return buffer
}

export class HitSoundPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private buffers = new Map<HitSoundKind, AudioBuffer>()
  private events: HitSoundEvent[] = []
  private next = 0
  private scheduled: AudioBufferSourceNode[] = []
  private lastNow = -1
  private lastRate = 1
  private wasPlaying = false
  enabled = true
  private _volume = 0.5

  get volume() {
    return this._volume
  }

  set volume(v: number) {
    this._volume = Math.min(Math.max(v, 0), 1)
    if (this.gain) this.gain.gain.value = this._volume
  }

  /** Create or resume the AudioContext; call from a user gesture (e.g. play). */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.gain = this.ctx.createGain()
      this.gain.gain.value = this._volume
      this.gain.connect(this.ctx.destination)
      for (const kind of Object.keys(SYNTHS) as HitSoundKind[]) this.buffers.set(kind, render(this.ctx, kind))
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setEvents(events: HitSoundEvent[]) {
    this.events = events
    this.reset()
  }

  /** Stop everything scheduled; the next update starts again from the clock. */
  reset() {
    for (const s of this.scheduled) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.scheduled = []
    this.next = -1
  }

  /** Call every frame with the playback clock. */
  update(now: number, playing: boolean, rate: number) {
    const ctx = this.ctx
    if (!ctx || !this.enabled || !playing) {
      if (this.wasPlaying) this.reset()
      this.wasPlaying = playing && this.enabled
      this.lastNow = now
      return
    }
    // a seek, a rate change or a resume invalidates what was scheduled
    const jumped = now < this.lastNow - 0.01 || now > this.lastNow + 0.5
    if (!this.wasPlaying || jumped || rate !== this.lastRate) this.reset()
    this.wasPlaying = true
    this.lastNow = now
    this.lastRate = rate

    if (this.next < 0) {
      this.next = this.events.findIndex((e) => e.time >= now)
      if (this.next < 0) this.next = this.events.length
    }
    const horizon = now + LOOKAHEAD * rate
    while (this.next < this.events.length && this.events[this.next]!.time <= horizon) {
      const e = this.events[this.next++]!
      const source = ctx.createBufferSource()
      source.buffer = this.buffers.get(e.kind)!
      source.connect(this.gain!)
      source.start(ctx.currentTime + Math.max(0, (e.time - now) / rate))
      source.onended = () => {
        const i = this.scheduled.indexOf(source)
        if (i >= 0) this.scheduled.splice(i, 1)
      }
      this.scheduled.push(source)
    }
  }

  destroy() {
    this.reset()
    void this.ctx?.close()
    this.ctx = null
  }
}
