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
  /**
   * Scrub by dragging left/right on the chart (the canvas width spans 2 seconds, Shift for
   * finer) and step note by note with the mouse wheel. Default true.
   */
  canvasControls?: boolean
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

/** How quickly the shown time catches up with the scrub target (seconds, time constant). */
const SCRUB_SMOOTHING = 0.05
/** A scrub further than this jumps most of the way at once instead of fast-forwarding. */
const SCRUB_MAX_GLIDE = 3
/** Seconds covered by dragging across the full width of the chart. */
const CANVAS_DRAG_SECONDS = 2
/** Pointer travel before a press on the chart becomes a drag. */
const DRAG_THRESHOLD_PX = 3
/** A wheel or keyboard step ends its scrub after this much quiet. */
const STEP_SETTLE_MS = 250

interface Scrub {
  /** Where the user is dragging to. */
  target: number
  /** What is drawn now; glides towards `target` so the chart visibly runs forwards or back. */
  shown: number
  wasPlaying: boolean
  lastFrame: number
}

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
  private scrub: Scrub | null = null
  /** Sorted unique audio times of notes and slide starts, for stepping. */
  private noteTimes: number[] = []
  private stepTimer: ReturnType<typeof setTimeout> | undefined
  private detachCanvas: () => void = () => {}
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
    if (options.canvasControls ?? true) this.detachCanvas = this.attachCanvasControls()
    this.frame = requestAnimationFrame(this.tick)
  }

  /** The parsed chart that is loaded, including any parse errors. */
  get chart(): Chart | null {
    return this._chart
  }

  /** The time being shown: the playback clock, or the scrub position while scrubbing. */
  get currentTime(): number {
    return this.scrub ? this.scrub.shown : (this.clock?.now() ?? 0)
  }

  /** True between beginScrub() and endScrub(). */
  get scrubbing(): boolean {
    return this.scrub !== null
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
    const times = new Set<number>()
    for (const p of this.prepared.notes) times.add(Math.round(p.time * 1000) / 1000)
    for (const s of this.prepared.slides) times.add(Math.round(s.startTime * 1000) / 1000)
    this.noteTimes = [...times].sort((a, b) => a - b)
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
    if (this.scrub) {
      this.scrubTo(time)
      return
    }
    this.clock?.seek(time)
    this.sounds.reset()
    this.dirty = true
  }

  /**
   * Start dragging through the chart (e.g. on a progress bar). Audio pauses, and the chart
   * follows scrubTo() smoothly in both directions, so dragging back plays it in reverse.
   */
  beginScrub() {
    if (this.scrub || !this.clock) return
    const now = this.clock.now()
    this.scrub = { target: now, shown: now, wasPlaying: this.clock.playing, lastFrame: performance.now() }
    this.clock.pause()
    this.sounds.reset()
  }

  /** Move the scrub target; starts a scrub if none is running. */
  scrubTo(time: number) {
    if (!this.scrub) this.beginScrub()
    if (!this.scrub) return
    const duration = this.duration
    this.scrub.target = Math.min(Math.max(time, 0), duration > 0 ? duration : Infinity)
  }

  /** Finish dragging: jump to where the user let go and resume if it was playing. */
  endScrub() {
    const scrub = this.scrub
    if (!scrub) return
    this.scrub = null
    this.clock?.seek(scrub.target)
    this.sounds.reset()
    this.dirty = true
    if (scrub.wasPlaying) void this.play()
  }

  /**
   * Jump to the previous (-1) or next (+1) moment where a note is hit or a slide starts.
   * Pauses playback, since stepping is for precise positioning.
   */
  stepNote(direction: 1 | -1) {
    if (!this.clock || this.noteTimes.length === 0) return
    if (this.playing && !this.scrub) this.pause()
    const from = this.scrub ? this.scrub.target : this.clock.now()
    const times = this.noteTimes
    let to: number | undefined
    if (direction > 0) to = times.find((t) => t > from + 0.001)
    else for (let i = times.length - 1; i >= 0 && to === undefined; i--) if (times[i]! < from - 0.001) to = times[i]
    if (to === undefined) return
    this.scrubTo(to)
    if (this.scrub) this.scrub.wasPlaying = false
    clearTimeout(this.stepTimer)
    this.stepTimer = setTimeout(() => this.endScrub(), STEP_SETTLE_MS)
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
    clearTimeout(this.stepTimer)
    this.detachCanvas()
    this.resizeObserver.disconnect()
    if (this.ownsAudio) this.clock?.destroy()
    else this.clock?.pause()
    this.listeners.clear()
    this.sounds.destroy()
  }

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick)
    if (this.scrub) this.glide(this.scrub)
    const now = this.currentTime
    this.sounds.update(now, this.playing && !this.scrub, this.clock?.rate ?? 1)
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

  private attachCanvasControls(): () => void {
    const canvas = this.canvas
    // vertical swipes still scroll the page on touch screens
    canvas.style.touchAction = 'pan-y'
    let press: { id: number; x: number; time: number; fine: boolean; dragging: boolean } | null = null

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !this.clock) return
      press = { id: e.pointerId, x: e.clientX, time: this.currentTime, fine: e.shiftKey, dragging: false }
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events have no capturable pointer
      }
    }
    const move = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return
      if (!press.dragging) {
        if (Math.abs(e.clientX - press.x) < DRAG_THRESHOLD_PX) return
        press.dragging = true
        this.beginScrub()
      }
      const secondsPerPx = (fine: boolean) => (CANVAS_DRAG_SECONDS / canvas.clientWidth) * (fine ? 0.25 : 1)
      if (e.shiftKey !== press.fine) {
        // re-anchor when Shift changes so the position does not jump
        press.time += (e.clientX - press.x) * secondsPerPx(press.fine)
        press.x = e.clientX
        press.fine = e.shiftKey
      }
      this.scrubTo(press.time + (e.clientX - press.x) * secondsPerPx(press.fine))
    }
    const up = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return
      if (press.dragging) this.endScrub()
      press = null
    }
    const wheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || !this.clock) return
      e.preventDefault()
      this.stepNote(e.deltaY > 0 ? 1 : -1)
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
    }
  }

  /** Move the shown scrub time towards its target, frame-rate independent. */
  private glide(scrub: Scrub) {
    const frame = performance.now()
    const dt = Math.min((frame - scrub.lastFrame) / 1000, 0.1)
    scrub.lastFrame = frame
    let gap = scrub.target - scrub.shown
    if (Math.abs(gap) > SCRUB_MAX_GLIDE) {
      scrub.shown = scrub.target - Math.sign(gap) * SCRUB_MAX_GLIDE
      gap = scrub.target - scrub.shown
    }
    scrub.shown = Math.abs(gap) < 0.0005 ? scrub.target : scrub.shown + gap * (1 - Math.exp(-dt / SCRUB_SMOOTHING))
  }
}
