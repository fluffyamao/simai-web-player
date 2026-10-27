// SPDX-License-Identifier: GPL-3.0-only
//
// Hit sound sets, all synthesised sample by sample (no recorded samples).
import type { HitSoundKind } from './hitSounds'

/**
 * Builds one sound: given a seeded random source, returns a function from time (seconds)
 * to a sample. The builder runs once per render, so the returned function may keep state
 * (filters, oscillator phase).
 */
export type SynthBuilder = (rand: () => number) => (t: number) => number

export interface SoundSpec {
  seconds: number
  gain: number
  build: SynthBuilder
}

export interface HitSoundPreset {
  id: string
  name: string
  sounds: Record<HitSoundKind, SoundSpec>
}

const TAU = Math.PI * 2
const decay = (t: number, rate: number) => Math.exp(-t * rate)
const sine = (f: number, t: number) => Math.sin(TAU * f * t)
const noise = (rand: () => number) => rand() * 2 - 1
/** 0 -> 1 -> 0 over `length` seconds. */
const hump = (t: number, length: number) => Math.sin(Math.PI * Math.min(t / length, 1))

/** One-pole low-pass; `a` near 0 is darker. */
function lowpass(a: number) {
  let y = 0
  return (x: number) => (y += a * (x - y))
}
function highpass(a: number) {
  const lp = lowpass(a)
  return (x: number) => x - lp(x)
}
/** Oscillator with a changing frequency (keeps phase continuous). */
function oscillator(wave: (phase: number) => number) {
  let phase = 0
  let last = 0
  return (freq: number, t: number) => {
    phase += freq * (t - last)
    last = t
    return wave(phase)
  }
}
const square = (p: number) => (p % 1 < 0.5 ? 1 : -1)
const sinWave = (p: number) => Math.sin(TAU * p)

const classic: HitSoundPreset = {
  id: 'classic',
  name: '经典',
  sounds: {
    // short bright click
    tap: { seconds: 0.06, gain: 0.6, build: (r) => (t) => sine(1760, t) * decay(t, 70) + noise(r) * decay(t, 400) * 0.5 },
    // two-tone chime with a crack
    break: {
      seconds: 0.35,
      gain: 0.55,
      build: (r) => (t) => (sine(1318, t) + sine(1976, t) * 0.7) * decay(t, 12) + noise(r) * decay(t, 60) * 0.6,
    },
    // soft pop
    touch: { seconds: 0.08, gain: 0.5, build: () => (t) => Math.sin(TAU * (700 + 500 * decay(t, 40)) * t) * decay(t, 45) },
    // short airy swish
    slide: { seconds: 0.3, gain: 0.25, build: (r) => (t) => noise(r) * hump(t, 0.3) * 0.8 },
    // crackling burst
    firework: {
      seconds: 0.8,
      gain: 0.45,
      build: (r) => (t) => noise(r) * decay(t, 5) * (r() < 0.02 ? 3 : 0.5) + sine(90, t) * decay(t, 8),
    },
  },
}

const wood: HitSoundPreset = {
  id: 'wood',
  name: '木鱼',
  sounds: {
    // hollow block: two inharmonic partials and a soft click
    tap: {
      seconds: 0.08,
      gain: 0.7,
      build: (r) => {
        const click = lowpass(0.3)
        return (t) => (sine(1250, t) * 0.7 + sine(1870, t) * 0.3) * decay(t, 55) + click(noise(r)) * decay(t, 400) * 0.5
      },
    },
    // block plus a low "dong" that bends down a little
    break: {
      seconds: 0.45,
      gain: 0.55,
      build: (r) => {
        const crack = highpass(0.2)
        return (t) =>
          (sine(1250, t) * 0.5 + sine(1870, t) * 0.2) * decay(t, 45) +
          Math.sin(TAU * 220 * t * (1 + 0.08 * decay(t, 25))) * decay(t, 9) * 0.8 +
          crack(noise(r)) * decay(t, 80) * 0.4
      },
    },
    // smaller, higher block
    touch: { seconds: 0.06, gain: 0.5, build: () => (t) => sine(1650, t) * decay(t, 70) + sine(2480, t) * 0.3 * decay(t, 90) },
    // brushed swish, darker than classic
    slide: {
      seconds: 0.28,
      gain: 1.2,
      build: (r) => {
        const lp = lowpass(0.08)
        return (t) => lp(noise(r)) * hump(t, 0.28)
      },
    },
    // crackle over a soft thump
    firework: {
      seconds: 0.9,
      gain: 0.6,
      build: (r) => {
        const lp = lowpass(0.25)
        return (t) => lp(noise(r) * (r() < 0.03 ? 4 : 0.4)) * decay(t, 4) + sine(70, t) * decay(t, 6) * 0.7
      },
    },
  },
}

const chip: HitSoundPreset = {
  id: 'chip',
  name: '电子',
  sounds: {
    // square blip falling from E6 to A5
    tap: {
      seconds: 0.05,
      gain: 0.22,
      build: () => {
        const osc = oscillator(square)
        return (t) => osc(1320 - 440 * Math.min(t / 0.05, 1), t) * decay(t, 30)
      },
    },
    // C6-E6-G6 arpeggio
    break: {
      seconds: 0.3,
      gain: 0.2,
      build: () => {
        const osc = oscillator(square)
        return (t) => osc(t < 0.06 ? 1047 : t < 0.12 ? 1319 : 1568, t) * decay(t, 6)
      },
    },
    touch: { seconds: 0.04, gain: 0.18, build: () => (t) => square(1760 * t) * decay(t, 60) },
    // rising sweep
    slide: {
      seconds: 0.22,
      gain: 0.14,
      build: () => {
        const osc = oscillator(square)
        return (t) => osc(440 + 880 * Math.min(t / 0.22, 1), t) * hump(t, 0.22)
      },
    },
    // 8-bit noise: random levels held for a few samples, over a low square
    firework: {
      seconds: 0.7,
      gain: 0.3,
      build: (r) => {
        let held = 0
        let next = 0
        return (t) => {
          if (t >= next) {
            held = noise(r)
            next = t + 1 / 4000
          }
          return held * decay(t, 5) + square(110 * t) * decay(t, 10) * 0.4
        }
      },
    },
  },
}

const crisp: HitSoundPreset = {
  id: 'crisp',
  name: '清脆',
  sounds: {
    // closed hi-hat with a tick
    tap: {
      seconds: 0.05,
      gain: 1.1,
      build: (r) => {
        const hp = highpass(0.6)
        return (t) => hp(noise(r)) * decay(t, 90) + sine(3000, t) * decay(t, 300) * 0.3
      },
    },
    // hand clap (three quick bursts and a tail) with a bright ping
    break: {
      seconds: 0.35,
      gain: 1.2,
      build: (r) => {
        const band = highpass(0.3)
        const lp = lowpass(0.5)
        return (t) => {
          const burst = t < 0.03 ? decay(t % 0.011, 300) : decay(t - 0.03, 18) * 0.6
          return band(lp(noise(r))) * burst + sine(2637, t) * decay(t, 20) * 0.35
        }
      },
    },
    // rimshot
    touch: {
      seconds: 0.06,
      gain: 0.9,
      build: (r) => {
        const band = highpass(0.25)
        const lp = lowpass(0.4)
        return (t) => band(lp(noise(r))) * decay(t, 120) + sine(1700, t) * decay(t, 80) * 0.5
      },
    },
    // shaker with a little tremolo
    slide: {
      seconds: 0.25,
      gain: 0.4,
      build: (r) => {
        const hp = highpass(0.5)
        return (t) => hp(noise(r)) * hump(t, 0.25) * (0.7 + 0.3 * sine(16, t))
      },
    },
    firework: {
      seconds: 0.9,
      gain: 0.45,
      build: (r) => {
        const hp = highpass(0.4)
        return (t) => hp(noise(r) * (r() < 0.02 ? 3 : 0.6)) * decay(t, 4) + sine(60, t) * decay(t, 7) * 0.6
      },
    },
  },
}

/** A struck bar: fundamental plus a quickly fading 4th harmonic. */
const bar = (f: number, t: number, ring: number) => sine(f, t) * decay(t, ring) + sine(f * 4, t) * 0.25 * decay(t, ring * 3)

const marimba: HitSoundPreset = {
  id: 'marimba',
  name: '马林巴',
  sounds: {
    tap: { seconds: 0.25, gain: 0.5, build: () => (t) => bar(1047, t, 18) },
    // C major chord
    break: { seconds: 0.6, gain: 0.35, build: () => (t) => bar(1047, t, 8) + bar(1319, t, 8) + bar(1568, t, 8) },
    touch: { seconds: 0.18, gain: 0.45, build: () => (t) => bar(1568, t, 22) },
    // gentle upward glide
    slide: {
      seconds: 0.3,
      gain: 0.18,
      build: () => {
        const osc = oscillator(sinWave)
        return (t) => osc(784 + 391 * Math.min(t / 0.3, 1), t) * hump(t, 0.3)
      },
    },
    // high sparkles at random moments
    firework: {
      seconds: 1.0,
      gain: 0.35,
      build: (r) => {
        const sparks = Array.from({ length: 14 }, () => ({ at: r() * 0.7, f: 1800 + r() * 2600 }))
        return (t) => {
          let sum = 0
          for (const s of sparks) if (t >= s.at) sum += sine(s.f, t - s.at) * decay(t - s.at, 25)
          return sum * 0.5 + sine(80, t) * decay(t, 6) * 0.5
        }
      },
    },
  },
}

export const HIT_SOUND_PRESETS: HitSoundPreset[] = [classic, wood, chip, crisp, marimba]
export const DEFAULT_HIT_SOUND_PRESET = 'classic'

export function findPreset(id: string): HitSoundPreset {
  return HIT_SOUND_PRESETS.find((p) => p.id === id) ?? classic
}
