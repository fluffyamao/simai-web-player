// SPDX-License-Identifier: GPL-3.0-only

/** Source of the current playback time, in seconds of audio. */
export interface Clock {
  readonly playing: boolean
  readonly duration: number
  readonly rate: number
  now(): number
  play(): Promise<void>
  pause(): void
  seek(time: number): void
  setRate(rate: number): void
  destroy(): void
}

/** Gaps between our time and the element's smaller than this are eased out, not snapped. */
const SNAP_THRESHOLD = 0.25
/** Time constant (seconds) for easing out small gaps. */
const SLEW_SECONDS = 0.5

/**
 * Clock driven by an <audio> element.
 *
 * `audio.currentTime` is not smooth: it advances in coarse steps, leaps ahead when playback
 * starts and stalls while the output starts up. Following it directly makes the chart jump
 * forward and snap back on every resume. Instead we keep our own time that
 * - stays exactly at the paused position until the audio really starts moving,
 * - then runs on performance.now(), easing towards the element's time without going back,
 * - and only snaps when they are far apart (a seek, or a long stall).
 */
export class MediaClock implements Clock {
  /** Our time, and the wall clock when it was last advanced. */
  private est = 0
  private estWall = 0
  /** Last value the element reported, and when it first reported it. */
  private lastMedia = -1
  private lastMediaWall = 0
  /** Playback was requested but the element's time has not moved yet. */
  private waitingStart = false
  /** Changes of the element's time seen while waiting; its first one is a start-up leap. */
  private startChanges = 0
  /** Whether the element was playing at the last now(), to catch resumes ourselves. */
  private wasPlaying = false

  constructor(readonly audio: HTMLAudioElement) {
    audio.preservesPitch = true
    const snap = () => this.snap()
    audio.addEventListener('seeked', snap)
    audio.addEventListener('pause', snap)
    this.snap()
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended
  }

  get duration() {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }

  get rate() {
    return this.audio.playbackRate
  }

  now(): number {
    const media = this.audio.currentTime
    const playing = this.playing
    const resumed = playing && !this.wasPlaying
    this.wasPlaying = playing
    if (!playing) return media
    if (resumed) {
      // the 'play' event comes later than paused turns false, so detect the resume here
      this.snap()
      this.waitingStart = true
      this.startChanges = 0
      return this.est
    }
    const wall = performance.now()
    if (media !== this.lastMedia) {
      this.lastMedia = media
      this.lastMediaWall = wall
      if (this.waitingStart && ++this.startChanges >= 2) {
        // the audio is really moving now (its first change is a leap before output starts):
        // run on from where we paused, easing towards the element from here
        this.waitingStart = false
        this.estWall = wall
        return this.est
      }
    }
    if (this.waitingStart) return this.est

    const rate = this.rate
    const dt = (wall - this.estWall) / 1000
    this.estWall = wall
    const next = this.est + dt * rate
    // where the element is now, extrapolated from its last report
    const media_ = this.lastMedia + ((wall - this.lastMediaWall) / 1000) * rate
    const gap = media_ - next
    if (Math.abs(gap) > SNAP_THRESHOLD) {
      this.est = media_
    } else {
      // ease the gap out, but never run backwards while playing
      this.est = Math.max(this.est, next + gap * Math.min(1, dt / SLEW_SECONDS))
    }
    return this.est
  }

  private snap() {
    const wall = performance.now()
    this.est = this.audio.currentTime
    this.estWall = wall
    this.lastMedia = this.est
    this.lastMediaWall = wall
  }

  play() {
    return this.audio.play()
  }

  pause() {
    this.audio.pause()
    // Chrome reports the audible position after pausing but resumes from where its decoder
    // was, ~70ms further on. Seeking to the reported position makes resume start right there.
    this.audio.currentTime = this.audio.currentTime
  }

  seek(time: number) {
    this.audio.currentTime = Math.max(0, time)
    this.snap()
    // while playing, the element needs a moment to continue from the new spot
    if (this.playing) {
      this.waitingStart = true
      this.startChanges = 0
    }
  }

  setRate(rate: number) {
    this.audio.playbackRate = rate
  }

  destroy() {
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }
}

/** Clock with no audio, for previewing a chart silently. */
export class FreeClock implements Clock {
  private startTime = 0
  private startWall = 0
  private _playing = false
  private _rate = 1

  constructor(readonly duration: number) {}

  get playing() {
    return this._playing
  }

  get rate() {
    return this._rate
  }

  now(): number {
    if (!this._playing) return this.startTime
    const t = this.startTime + ((performance.now() - this.startWall) / 1000) * this._rate
    if (t >= this.duration) {
      this._playing = false
      this.startTime = this.duration
      return this.duration
    }
    return t
  }

  async play() {
    if (this.startTime >= this.duration) this.startTime = 0
    this.startWall = performance.now()
    this._playing = true
  }

  pause() {
    this.startTime = this.now()
    this._playing = false
  }

  seek(time: number) {
    this.startTime = Math.min(Math.max(0, time), this.duration)
    this.startWall = performance.now()
  }

  setRate(rate: number) {
    this.startTime = this.now()
    this.startWall = performance.now()
    this._rate = rate
  }

  destroy() {
    this._playing = false
  }
}
