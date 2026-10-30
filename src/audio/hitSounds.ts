// SPDX-License-Identifier: GPL-3.0-only
import type { Note } from '../parser/types'
import { loadBuiltInSounds } from './builtInSounds'
import { DEFAULT_HIT_SOUND_PRESET } from './presets'
import type { PackSound } from './soundPack'

export type HitSoundKind = 'answer' | 'tap' | 'ex' | 'break' | 'cheer' | 'touch' | 'touchHold'
  | 'slide' | 'breakSlide' | 'breakSlideCheer' | 'firework'

export interface HitSoundEvent {
  /** Audio time in seconds. */
  time: number
  kind: HitSoundKind
  /** Only touch holds have a sustained sound, stopped at release. */
  duration?: number
}
const LOOKAHEAD = 0.15
const MIN_HOLD_FOR_ANSWER = 1 / 60

/** Autoplay's successful judgements, following MajdataPlay NoteAudioManager. */
export function hitSoundEvents(notes: { note: Note; time: number }[], fireworks: boolean): HitSoundEvent[] {
  const seen = new Set<string>()
  const events: HitSoundEvent[] = []
  const holds: { start: number; end: number }[] = []
  const add = (time: number, kind: HitSoundKind) => {
    const key = `${Math.round(time * 1000)}:${kind}`
    if (seen.has(key)) return
    seen.add(key)
    events.push({ time, kind })
  }
  const judge = (time: number, note: Note) => {
    add(time, note.isBreak ? 'break' : note.isEx ? 'ex' : 'tap')
    if (note.isBreak) add(time, 'cheer')
  }
  for (const { note, time } of notes) {
    if (note.isMine) continue
    const hasHead = note.location.group !== 'button' || note.head !== 'none'
    if (hasHead) {
      add(time, 'answer')
      if (note.length >= MIN_HOLD_FOR_ANSWER) add(time + note.length, 'answer')
    }
    if (note.location.group === 'button') {
      if (hasHead) judge(time, note)
      for (const s of note.slides) {
        const start = time + s.delay
        add(start, s.isBreak ? 'breakSlide' : 'slide')
        if (s.isBreak) {
          add(start + s.duration, 'breakSlideCheer')
          add(start + s.duration, 'cheer')
        }
      }
    } else if (note.kind === 'touchHold') {
      if (note.length > 0) holds.push({ start: time, end: time + note.length })
      judge(time + note.length, note)
      if (note.isFirework && fireworks) add(time + note.length, 'firework')
    } else {
      add(time, note.isBreak ? 'break' : 'touch')
      if (note.isBreak) add(time, 'cheer')
      if (note.isFirework && fireworks) add(time, 'firework')
    }
  }
  // MajdataPlay runs one riser while any touch hold is active; overlapping holds don't stack it.
  const merged: { start: number; end: number }[] = []
  for (const hold of holds.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1]
    if (previous && hold.start <= previous.end) previous.end = Math.max(previous.end, hold.end)
    else merged.push({ ...hold })
  }
  for (const hold of merged) events.push({ time: hold.start, kind: 'touchHold', duration: hold.end - hold.start })
  return events.sort((a, b) => a.time - b.time)
}

const PACK_FALLBACK: Partial<Record<HitSoundKind, HitSoundKind>> = { ex: 'tap', breakSlide: 'slide' }
const ANSWER_LEVEL = 0.5

export class HitSoundPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private kindGains = new Map<HitSoundKind, GainNode>()
  private kindVolumes = new Map<HitSoundKind, number>()
  private buffers = new Map<HitSoundKind, AudioBuffer>()
  private samples = new Map<HitSoundKind, PackSound>()
  private pack = new Map<HitSoundKind, PackSound>()
  private packGain = 1
  private packBuffers = new Map<HitSoundKind, AudioBuffer>()
  private events: HitSoundEvent[] = []
  private next = -1
  private scheduled: AudioBufferSourceNode[] = []
  private audition: AudioBufferSourceNode | null = null
  private previewVersion = 0
  private lastNow = -1
  private lastRate = 1
  private wasPlaying = false
  private destroyed = false
  enabled = true
  private _volume = 0.5
  readonly ready: Promise<void>
  loadErrors: string[] = []

  get preset() { return DEFAULT_HIT_SOUND_PRESET }
  // Retained for consumers with a saved legacy preset; there is only B_full now.
  set preset(_id: string) {}

  /** `soundBase`: the folder holding the B_full WAV files. */
  constructor(soundBase?: string) {
    this.ready = loadBuiltInSounds(soundBase).then(({ sounds, failed }) => {
      if (this.destroyed) return
      this.loadErrors = failed
      this.samples = new Map(sounds.map((s) => [s.kind, s]))
      if (this.ctx) for (const [kind, sound] of this.samples) this.buffers.set(kind, this.makeBuffer(sound))
    })
  }

  get volume() { return this._volume }
  set volume(v: number) {
    this._volume = Math.min(Math.max(v, 0), 1)
    if (this.gain) this.gain.gain.value = this._volume
  }

  getKindVolume(kind: HitSoundKind): number { return this.kindVolumes.get(kind) ?? 1 }

  /** Relative to the master volume; updates even a currently playing sustained sound. */
  setKindVolume(kind: HitSoundKind, volume: number) {
    if (!Number.isFinite(volume)) return
    const value = Math.min(1, Math.max(0, volume))
    this.kindVolumes.set(kind, value)
    const output = this.kindGains.get(kind)
    if (output) output.gain.value = value
  }

  private outputFor(kind: HitSoundKind): GainNode {
    let output = this.kindGains.get(kind)
    if (!output) {
      output = this.ctx!.createGain()
      output.gain.value = this.getKindVolume(kind)
      output.connect(this.gain!)
      this.kindGains.set(kind, output)
    }
    return output
  }

  /** Must run synchronously from the user's play gesture. */
  unlock() {
    if (this.destroyed) return
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.gain = this.ctx.createGain()
      this.gain.gain.value = this._volume
      this.gain.connect(this.ctx.destination)
      for (const [kind, sound] of this.samples) this.buffers.set(kind, this.makeBuffer(sound))
      this.makePackBuffers()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Optional consumer-owned overrides; the website disables restoring old local packs. */
  setPack(sounds: PackSound[]) {
    this.reset()
    this.pack = new Map(sounds.map((s) => [s.kind, s]))
    let peak = 0
    for (const s of sounds) if (s.kind !== 'answer') {
      for (const ch of s.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v))
    }
    this.packGain = peak > 0 ? Math.min(0.9 / peak, 4) : 1
    this.makePackBuffers()
  }

  get packFiles(): Partial<Record<HitSoundKind, string>> {
    return Object.fromEntries([...this.pack].map(([k, s]) => [k, s.name]))
  }

  private makeBuffer(sound: PackSound, scale = 1): AudioBuffer {
    const buffer = this.ctx!.createBuffer(sound.channels.length, sound.channels[0]!.length, sound.sampleRate)
    const gain = scale * (sound.kind === 'answer' ? ANSWER_LEVEL : 1)
    sound.channels.forEach((channel, index) => buffer.copyToChannel(channel.map((v) => v * gain), index))
    return buffer
  }

  private makePackBuffers() {
    this.packBuffers.clear()
    if (!this.ctx) return
    for (const [kind, sound] of this.pack) this.packBuffers.set(kind, this.makeBuffer(sound, this.packGain))
  }

  private bufferFor(kind: HitSoundKind): AudioBuffer | undefined {
    const fallback = PACK_FALLBACK[kind]
    return this.packBuffers.get(kind) ?? (fallback && this.packBuffers.get(fallback)) ?? this.buffers.get(kind)
  }

  preview(kind: HitSoundKind) {
    this.stopPreview()
    const version = this.previewVersion
    this.unlock()
    void this.ready.then(() => {
      if (!this.ctx || this.destroyed || version !== this.previewVersion) return
      const buffer = this.bufferFor(kind)
      if (!buffer) return
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.connect(this.outputFor(kind))
      source.start()
      this.audition = source
      this.scheduled.push(source)
      source.onended = () => {
        if (this.audition === source) this.audition = null
        this.removeSource(source)
      }
    })
  }

  stopPreview() {
    this.previewVersion++
    const source = this.audition
    this.audition = null
    if (source) {
      try { source.stop() } catch { /* Already finished. */ }
      this.removeSource(source)
    }
  }

  setEvents(events: HitSoundEvent[]) { this.events = events; this.reset() }

  reset() {
    this.stopPreview()
    for (const source of this.scheduled) {
      try { source.stop() } catch { /* Already finished. */ }
    }
    this.scheduled = []
    this.next = -1
  }

  private removeSource(source: AudioBufferSourceNode) {
    const index = this.scheduled.indexOf(source)
    if (index >= 0) this.scheduled.splice(index, 1)
    source.disconnect()
  }

  update(now: number, playing: boolean, rate: number) {
    const ctx = this.ctx
    if (!ctx || !this.enabled || !playing) {
      if (this.wasPlaying) this.reset()
      this.wasPlaying = playing && this.enabled
      this.lastNow = now
      return
    }
    const jumped = now < this.lastNow - 0.01 || now > this.lastNow + 0.5
    if (!this.wasPlaying || jumped || rate !== this.lastRate) this.reset()
    this.wasPlaying = true
    this.lastNow = now
    this.lastRate = rate
    if (this.next < 0) {
      this.next = this.events.findIndex((e) => e.time >= now || (e.duration !== undefined && e.time + e.duration > now))
      if (this.next < 0) this.next = this.events.length
    }
    const horizon = now + LOOKAHEAD * rate
    while (this.next < this.events.length && this.events[this.next]!.time <= horizon) {
      const event = this.events[this.next++]!
      if (event.duration === undefined && event.time < now - 0.02) continue
      const buffer = this.bufferFor(event.kind)
      if (!buffer) continue
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const when = ctx.currentTime + Math.max(0, (event.time - now) / rate)
      if (event.duration !== undefined) {
        const offset = Math.max(0, now - event.time)
        const length = Math.min(buffer.duration - offset, (event.duration - offset) / rate)
        if (length <= 0) continue
        const envelope = ctx.createGain()
        envelope.gain.setValueAtTime(1, when)
        envelope.gain.setValueAtTime(1, Math.max(when, when + length - 0.005))
        envelope.gain.linearRampToValueAtTime(0, when + length)
        source.connect(envelope)
        envelope.connect(this.outputFor(event.kind))
        source.start(when, offset, length)
        source.onended = () => { envelope.disconnect(); this.removeSource(source) }
      } else {
        source.connect(this.outputFor(event.kind))
        source.start(when)
        source.onended = () => this.removeSource(source)
      }
      this.scheduled.push(source)
    }
  }

  destroy() {
    this.destroyed = true
    this.reset()
    void this.ctx?.close()
    this.ctx = null
    this.kindGains.clear()
  }
}
