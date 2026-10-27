// SPDX-License-Identifier: GPL-3.0-only
//
// Hit sounds, synthesised in code (no game samples), scheduled on Web Audio a little
// ahead of the playback clock so they land on time.
import type { Note } from '../parser/types'
import { DEFAULT_HIT_SOUND_PRESET, findPreset, type SoundSpec } from './presets'

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

/** Render one sound to samples at `sampleRate`. */
export function renderSound(spec: SoundSpec, sampleRate: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.ceil(spec.seconds * sampleRate))
  let seed = 1234567
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const fn = spec.build(rand)
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate
    // 2 ms fade-out at the end to avoid clicks
    const tail = Math.min(1, (spec.seconds - t) / 0.002)
    data[i] = Math.max(-1, Math.min(1, fn(t) * spec.gain * tail))
  }
  return data
}

const KINDS: HitSoundKind[] = ['tap', 'break', 'touch', 'slide', 'firework']

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
  private _preset = DEFAULT_HIT_SOUND_PRESET

  /** Id of the sound set in use (see HIT_SOUND_PRESETS). */
  get preset() {
    return this._preset
  }

  set preset(id: string) {
    this._preset = findPreset(id).id
    if (this.ctx) this.renderBuffers(this.ctx)
  }

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
      this.renderBuffers(this.ctx)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private renderBuffers(ctx: AudioContext) {
    const preset = findPreset(this._preset)
    for (const kind of KINDS) {
      const samples = renderSound(preset.sounds[kind], ctx.sampleRate)
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
      buffer.copyToChannel(samples, 0)
      this.buffers.set(kind, buffer)
    }
  }

  /** Play one sound right away, e.g. to audition a sound set. Call from a user gesture. */
  preview(kind: HitSoundKind) {
    this.unlock()
    const ctx = this.ctx!
    const source = ctx.createBufferSource()
    source.buffer = this.buffers.get(kind)!
    source.connect(this.gain!)
    source.start()
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
