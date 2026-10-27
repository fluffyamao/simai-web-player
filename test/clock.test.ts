import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaClock } from '../src/core/clock'

/** Just enough of an <audio> element for MediaClock. */
class FakeAudio {
  currentTime = 0
  paused = true
  ended = false
  playbackRate = 1
  duration = 200
  preservesPitch = false
  private handlers = new Map<string, (() => void)[]>()
  addEventListener(type: string, fn: () => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn])
  }
  fire(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn()
  }
  play() {
    this.paused = false
    this.fire('play')
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.fire('pause')
  }
}

const FRAME = 1000 / 60
let wall = 0
afterEach(() => vi.restoreAllMocks())

function setup(pausedAt: number) {
  wall = 0
  vi.spyOn(performance, 'now').mockImplementation(() => wall)
  const audio = new FakeAudio()
  audio.currentTime = pausedAt
  const clock = new MediaClock(audio as unknown as HTMLAudioElement)
  return { audio, clock }
}

describe('MediaClock', () => {
  it('resumes from the paused spot without jumping ahead or snapping back', () => {
    const { audio, clock } = setup(1.942)
    void clock.play()
    // what Chrome reported after resuming: a leap ahead, then a stall while output starts
    const reported = [1.942, 1.942, 2.001, 2.018, 2.018, 2.018, 2.018, 2.031, 2.048, 2.065, 2.081]
    for (let t = 2.098; t < 3.5; t += FRAME / 1000) reported.push(t)
    const shown: number[] = []
    for (const media of reported) {
      audio.currentTime = media
      shown.push(clock.now())
      wall += FRAME
    }
    expect(shown[0]).toBe(1.942)
    // holds through the start-up leap, then runs on from where it was paused
    expect(shown[2]).toBe(1.942)
    expect(shown[3]).toBe(1.942)
    for (let i = 1; i < shown.length; i++) {
      const step = shown[i]! - shown[i - 1]!
      expect(step).toBeGreaterThanOrEqual(0) // never backwards
      expect(step).toBeLessThan((FRAME / 1000) * 1.6) // never a visible jump
    }
    // and catches up with the audio within about a second
    expect(Math.abs(shown[shown.length - 1]! - reported[reported.length - 1]!)).toBeLessThan(0.01)
  })

  it('holds still until the audio starts after play', () => {
    const { audio, clock } = setup(10)
    void clock.play()
    for (let i = 0; i < 10; i++) {
      wall += FRAME
      expect(clock.now()).toBe(10)
    }
    audio.currentTime = 10.02 // start-up leap
    expect(clock.now()).toBe(10)
    wall += FRAME
    audio.currentTime = 10.03 // really moving
    expect(clock.now()).toBe(10)
    wall += FRAME
    // runs on from 10, easing only slightly towards the element
    const t = clock.now()
    expect(t).toBeGreaterThan(10 + FRAME / 1000 - 1e-9)
    expect(t).toBeLessThan(10 + FRAME / 1000 + 0.002)
  })

  it('snaps on big jumps and reports the element time while paused', () => {
    const { audio, clock } = setup(5)
    void clock.play()
    clock.now() // notices the resume
    wall += FRAME
    audio.currentTime = 5.01
    clock.now() // start-up leap
    wall += FRAME
    audio.currentTime = 5.02
    clock.now() // audio is moving
    wall += FRAME
    audio.currentTime = 30 // e.g. someone else seeked the element
    wall += FRAME
    expect(clock.now()).toBeCloseTo(30, 1)
    clock.pause()
    audio.currentTime = 42
    expect(clock.now()).toBe(42)
  })
})
