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

/**
 * Clock driven by an <audio> element.
 *
 * `audio.currentTime` only advances in coarse steps in some browsers, which makes
 * notes stutter. Between updates we extrapolate from performance.now() and only
 * snap back to the element when the two drift apart.
 */
export class MediaClock implements Clock {
  private anchorMedia = 0
  private anchorWall = 0
  private lastMedia = -1

  constructor(readonly audio: HTMLAudioElement) {
    audio.preservesPitch = true
    const resync = () => this.resync()
    audio.addEventListener('seeked', resync)
    audio.addEventListener('play', resync)
    audio.addEventListener('pause', resync)
    audio.addEventListener('ratechange', resync)
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
    if (!this.playing) return media
    const wall = performance.now()
    if (media !== this.lastMedia) {
      // the element reported a new position; keep our estimate unless it drifted
      this.lastMedia = media
      const predicted = this.anchorMedia + ((wall - this.anchorWall) / 1000) * this.rate
      if (Math.abs(predicted - media) > 0.05) this.resync()
    }
    return this.anchorMedia + ((wall - this.anchorWall) / 1000) * this.rate
  }

  private resync() {
    this.anchorMedia = this.audio.currentTime
    this.anchorWall = performance.now()
    this.lastMedia = this.anchorMedia
  }

  play() {
    return this.audio.play()
  }

  pause() {
    this.audio.pause()
  }

  seek(time: number) {
    this.audio.currentTime = Math.max(0, time)
    this.resync()
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
