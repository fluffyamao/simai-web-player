// SPDX-License-Identifier: GPL-3.0-only
import { hitSoundEvents, HitSoundPlayer } from './audio/hitSounds'
import { FreeClock, MediaClock, type Clock } from './core/clock'
import { noteSpeedFromSetting } from './core/geometry'
import { parseSimai } from './parser/simai'
import type { Chart, Maidata } from './parser/types'
import { prepareChart, Renderer, type PreparedChart } from './render/renderer'

export interface PlayerOptions {
  /** In-game tap speed setting, 1.0 .. 10.0. Default 7.5. */
  tapSpeed?: number
  /** In-game touch speed setting. Default 7.5. */
  touchSpeed?: number
  /** Show the firework burst of touches marked `f`. Default true. */
  fireworks?: boolean
  /** Play synthesised hit sounds. Default true. */
  hitSounds?: boolean
  /** Hit sound volume, 0..1. Default 0.5. */
  hitSoundVolume?: number
}

export interface LoadOptions {
  /** A parsed maidata.txt and the difficulty index to play (1..7). */
  maidata: Maidata
  difficulty: number
  /**
   * Audio to sync with: a URL, or an <audio> element you manage yourself.
   * Leave it out to preview the chart silently.
   */
  audio?: string | HTMLAudioElement
}

type TimeListener = (time: number) => void

/**
 * Plays a simai chart on a canvas, in sync with audio.
 *
 * ```ts
 * const player = new SimaiPlayer(canvas)
 * await player.load({ maidata: parseMaidata(text), difficulty: 5, audio: 'track.mp3' })
 * player.play()
 * ```
 */
export class SimaiPlayer {
  private renderer: Renderer
  private clock: Clock | null = null
  private ownsAudio = false
  private prepared: PreparedChart | null = null
  private _chart: Chart | null = null
  private speed: number
  private touchSpeed: number
  private fireworks: boolean
  private sounds = new HitSoundPlayer()
  private frame = 0
  private dirty = true
  private lastTime = -1
  private listeners = new Set<TimeListener>()
  private resizeObserver: ResizeObserver

  constructor(readonly canvas: HTMLCanvasElement, options: PlayerOptions = {}) {
    this.renderer = new Renderer(canvas)
    this.speed = noteSpeedFromSetting(options.tapSpeed ?? 7.5)
    this.touchSpeed = options.touchSpeed ?? 7.5
    this.fireworks = options.fireworks ?? true
    this.sounds.enabled = options.hitSounds ?? true
    this.sounds.volume = options.hitSoundVolume ?? 0.5
    this.resizeObserver = new ResizeObserver(() => {
      if (this.renderer.resize()) this.dirty = true
    })
    this.resizeObserver.observe(canvas)
    this.renderer.resize()
    this.frame = requestAnimationFrame(this.tick)
  }

  /** The parsed chart that is loaded, including any parse errors. */
  get chart(): Chart | null {
    return this._chart
  }

  get currentTime(): number {
    return this.clock?.now() ?? 0
  }

  get duration(): number {
    return this.clock?.duration ?? 0
  }

  get playing(): boolean {
    return this.clock?.playing ?? false
  }

  async load(options: LoadOptions): Promise<Chart> {
    const difficulty = options.maidata.difficulties.find((d) => d.index === options.difficulty)
    if (!difficulty) throw new Error(`difficulty ${options.difficulty} not found`)
    const bpm = parseFloat(options.maidata.meta.wholebpm ?? '')
    const chart = parseSimai(difficulty.chart, { defaultBpm: bpm })
    const first = difficulty.first ?? options.maidata.first

    this.clock?.pause()
    if (this.ownsAudio) this.clock?.destroy()
    this.clock = null

    if (options.audio) {
      const audio = typeof options.audio === 'string' ? new Audio(options.audio) : options.audio
      this.ownsAudio = typeof options.audio === 'string'
      audio.preload = 'auto'
      if (!(audio.readyState >= HTMLMediaElement.HAVE_METADATA)) {
        await new Promise<void>((resolve, reject) => {
          audio.addEventListener('loadedmetadata', () => resolve(), { once: true })
          audio.addEventListener('error', () => reject(new Error('could not load audio')), { once: true })
        })
      }
      this.clock = new MediaClock(audio)
    } else {
      this.ownsAudio = false
      this.clock = new FreeClock(chart.endTime + first + 2)
    }

    this._chart = chart
    this.prepared = prepareChart(chart, first)
    this.updateSoundEvents()
    this.dirty = true
    return chart
  }

  play() {
    // browsers only allow audio to start from a user gesture, which play() usually is
    if (this.sounds.enabled) this.sounds.unlock()
    return this.clock?.play() ?? Promise.resolve()
  }

  pause() {
    this.clock?.pause()
    this.dirty = true
  }

  toggle() {
    return this.playing ? this.pause() : this.play()
  }

  seek(time: number) {
    this.clock?.seek(time)
    this.sounds.reset()
    this.dirty = true
  }

  /** Playback speed, e.g. 0.5 for half speed. Pitch is kept when audio is used. */
  setRate(rate: number) {
    this.clock?.setRate(rate)
  }

  setTapSpeed(tapSpeed: number) {
    this.speed = noteSpeedFromSetting(tapSpeed)
    this.dirty = true
  }

  setTouchSpeed(touchSpeed: number) {
    this.touchSpeed = touchSpeed
    this.dirty = true
  }

  /** Show or hide the firework burst of `f` touches. */
  setFireworks(enabled: boolean) {
    this.fireworks = enabled
    this.updateSoundEvents()
    this.dirty = true
  }

  /** Turn hit sounds on or off, optionally setting the volume (0..1). */
  setHitSounds(enabled: boolean, volume?: number) {
    this.sounds.enabled = enabled
    if (volume !== undefined) this.sounds.volume = volume
    if (enabled && this.playing) this.sounds.unlock()
  }

  private updateSoundEvents() {
    this.sounds.setEvents(this.prepared ? hitSoundEvents(this.prepared.notes, this.fireworks) : [])
  }

  /** Called every frame while the time changes. Returns an unsubscribe function. */
  onTime(listener: TimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    if (this.ownsAudio) this.clock?.destroy()
    else this.clock?.pause()
    this.listeners.clear()
    this.sounds.destroy()
  }

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick)
    const now = this.currentTime
    this.sounds.update(now, this.playing, this.clock?.rate ?? 1)
    if (!this.dirty && now === this.lastTime) return
    this.dirty = false
    this.lastTime = now
    this.renderer.render(this.prepared, now, {
      speed: this.speed,
      touchSpeed: this.touchSpeed,
      fireworks: this.fireworks,
    })
    for (const l of this.listeners) l(now)
  }
}
