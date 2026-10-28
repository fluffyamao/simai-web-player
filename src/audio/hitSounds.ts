// SPDX-License-Identifier: GPL-3.0-only
//
// Hit sounds, synthesised in code (no game samples), scheduled on Web Audio a little
// ahead of the playback clock so they land on time.
import type { Note } from '../parser/types'
import { DEFAULT_HIT_SOUND_PRESET, findPreset, soundFor, type SoundSpec } from './presets'
import type { PackSound } from './soundPack'

export type HitSoundKind =
  | 'answer' // guide sound at every moment a note lands (and when holds end)
  | 'tap'
  | 'ex' // EX notes (with the protective shell), instead of tap
  | 'break'
  | 'touch'
  | 'slide'
  | 'breakSlide' // start of a break slide
  | 'firework'

export interface HitSoundEvent {
  /** Audio time in seconds. */
  time: number
  kind: HitSoundKind
}

/** Seconds of audio scheduled ahead of the clock. */
const LOOKAHEAD = 0.15

/** Shortest hold whose release gets its own answer sound (one frame, as in MajdataPlay). */
const MIN_HOLD_FOR_ANSWER = 1 / 60

/**
 * Hit sound events for a chart, in audio time, following MajdataPlay's rules:
 * an answer sound at every moment a note lands or a hold ends, plus the note's own sound
 * (tap, ex or break; touch; slide or break slide at the slide start, break at its end;
 * firework when a firework touch finishes). One sound per kind per moment.
 */
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
    const hasHead = note.location.group !== 'button' || note.head !== 'none'
    if (hasHead) {
      add(time, 'answer')
      if (note.length >= MIN_HOLD_FOR_ANSWER) add(time + note.length, 'answer')
    }
    if (note.location.group === 'button') {
      if (hasHead) add(time, note.isBreak ? 'break' : note.isEx ? 'ex' : 'tap')
      for (const s of note.slides) {
        const start = time + s.delay
        add(start, s.isBreak ? 'breakSlide' : 'slide')
        if (s.isBreak) add(start + s.duration, 'break')
      }
    } else {
      add(time, note.isBreak ? 'break' : 'touch')
      if (note.isFirework && fireworks) add(time + note.length, 'firework')
    }
  }
  return events.sort((a, b) => a.time - b.time)
}

/** Render one sound to samples at `sampleRate`. */
export function renderSound(spec: SoundSpec, sampleRate: number): Float32Array<ArrayBuffer> {
  const steps = renderSteps(spec, sampleRate, Infinity)
  let r = steps.next()
  while (!r.done) r = steps.next()
  return r.value
}

/** Render in chunks of `chunk` samples, yielding between them so the page stays responsive. */
function* renderSteps(spec: SoundSpec, sampleRate: number, chunk: number): Generator<void, Float32Array<ArrayBuffer>> {
  const data = new Float32Array(Math.ceil(spec.seconds * sampleRate))
  let seed = 1234567
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const fn = spec.build(rand, sampleRate)
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate
    // 2 ms fade-out at the end to avoid clicks
    const tail = Math.min(1, (spec.seconds - t) / 0.002)
    data[i] = Math.max(-1, Math.min(1, fn(t) * spec.gain * tail))
    if ((i + 1) % chunk === 0) yield
  }
  return data
}

/** Sounds are rendered at this rate; the browser resamples if its output rate differs. */
const RENDER_RATE = 48000
/** Samples per rendering step (~10-20 ms of work). */
const RENDER_CHUNK = 8192

const KINDS: HitSoundKind[] = ['answer', 'tap', 'ex', 'break', 'touch', 'slide', 'breakSlide', 'firework']

/** A user pack is scaled so its loudest note sound peaks here (about the built-in sets' level). */
const PACK_PEAK = 0.9
/** The answer guide sound is mixed at half the note sounds' level. */
const PACK_ANSWER_LEVEL = 0.5
/** Within a pack, a missing sound borrows another of the pack's own sounds. */
const PACK_FALLBACK: Partial<Record<HitSoundKind, HitSoundKind>> = { ex: 'tap', breakSlide: 'slide' }

export class HitSoundPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private buffers = new Map<HitSoundKind, AudioBuffer>()
  /** Rendered samples per kind, ready before there is an AudioContext. */
  private samples = new Map<HitSoundKind, Float32Array<ArrayBuffer>>()
  /** Bumped whenever a new set starts rendering, so stale renders stop. */
  private renderToken = 0
  /** User-supplied sounds; these replace the set's sounds where present. */
  private pack = new Map<HitSoundKind, PackSound>()
  private packGain = 1
  private packBuffers = new Map<HitSoundKind, AudioBuffer>()
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
    const next = findPreset(id).id
    if (next === this._preset && this.renderToken > 0) return
    this._preset = next
    void this.render()
  }

  constructor() {
    // render in the background straight away, so the first play has its sounds ready
    void this.render()
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
      for (const kind of this.samples.keys()) this.makeBuffer(kind)
      this.makePackBuffers()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Render the current set a little at a time; sounds become playable as they finish. */
  private async render() {
    const token = ++this.renderToken
    const preset = findPreset(this._preset)
    this.samples.clear()
    this.buffers.clear()
    for (const kind of KINDS) {
      const spec = soundFor(preset, kind)
      if (!spec) continue // e.g. sets without an answer sound
      const steps = renderSteps(spec, RENDER_RATE, RENDER_CHUNK)
      let r = steps.next()
      while (!r.done) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (token !== this.renderToken) return // another set was chosen meanwhile
        r = steps.next()
      }
      this.samples.set(kind, r.value)
      if (this.ctx) this.makeBuffer(kind)
    }
  }

  /** Use these user sounds instead of the set's (an empty list goes back to the set). */
  setPack(sounds: PackSound[]) {
    this.pack = new Map(sounds.map((s) => [s.kind, s]))
    let peak = 0
    for (const s of sounds) {
      if (s.kind === 'answer') continue
      for (const ch of s.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v))
    }
    this.packGain = peak > 0 ? Math.min(PACK_PEAK / peak, 4) : 1
    this.makePackBuffers()
  }

  /** Names of the user's files in use, by sound. */
  get packFiles(): Partial<Record<HitSoundKind, string>> {
    return Object.fromEntries([...this.pack].map(([k, s]) => [k, s.name]))
  }

  private makePackBuffers() {
    this.packBuffers.clear()
    if (!this.ctx) return
    for (const [kind, sound] of this.pack) {
      const gain = this.packGain * (kind === 'answer' ? PACK_ANSWER_LEVEL : 1)
      const length = sound.channels[0]?.length ?? 0
      if (length === 0) continue
      const buffer = this.ctx.createBuffer(sound.channels.length, length, sound.sampleRate)
      sound.channels.forEach((ch, i) => buffer.copyToChannel(ch.map((v) => v * gain), i))
      this.packBuffers.set(kind, buffer)
    }
  }

  /** The buffer to play for a sound: the user's pack first, then the chosen set. */
  private bufferFor(kind: HitSoundKind): AudioBuffer | undefined {
    const fallback = PACK_FALLBACK[kind]
    return this.packBuffers.get(kind) ?? (fallback && this.packBuffers.get(fallback)) ?? this.buffers.get(kind)
  }

  private makeBuffer(kind: HitSoundKind) {
    const samples = this.samples.get(kind)
    if (!this.ctx || !samples) return
    const buffer = this.ctx.createBuffer(1, samples.length, RENDER_RATE)
    buffer.copyToChannel(samples, 0)
    this.buffers.set(kind, buffer)
  }

  /** Play one sound right away, e.g. to audition a sound set. Call from a user gesture. */
  preview(kind: HitSoundKind) {
    this.unlock()
    const ctx = this.ctx!
    const buffer = this.bufferFor(kind)
    if (!buffer) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
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
      const buffer = this.bufferFor(e.kind)
      if (!buffer) continue
      const source = ctx.createBufferSource()
      source.buffer = buffer
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
    this.renderToken++
    this.reset()
    void this.ctx?.close()
    this.ctx = null
  }
}
