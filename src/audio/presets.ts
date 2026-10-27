// SPDX-License-Identifier: GPL-3.0-only
//
// Hit sound sets, all synthesised sample by sample (no recorded samples).
import type { HitSoundKind } from './hitSounds'

/**
 * Builds one sound: given a seeded random source, returns a function from time (seconds)
 * to a sample. The builder runs once per render, so the returned function may keep state
 * (filters, oscillator phase).
 */
export type SynthBuilder = (rand: () => number, sampleRate: number) => (t: number) => number

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
/**
 * Resonant band-pass (biquad) whose centre frequency can move per sample.
 * `q` is the resonance; the output is normalised to unity gain at the centre.
 */
function bandpass(sampleRate: number, q: number) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x: number, freq: number) => {
    const w = (TAU * Math.min(freq, sampleRate * 0.45)) / sampleRate
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    const y = ((alpha * x - alpha * x2) - -2 * Math.cos(w) * y1 - (1 - alpha) * y2) / a0
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
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

// Modelled on measurements of the arcade's own sounds (envelopes and partials only;
// everything is synthesised, no recorded audio is used).
const arcade: HitSoundPreset = {
  id: 'arcade',
  name: '街机',
  sounds: {
    // bell centred on G6 (1568 Hz) with C6, G5 and upper partials, and a short knock
    tap: {
      seconds: 0.45,
      gain: 0.27,
      build: (r, rate) => {
        const sheen = bandpass(rate, 2)
        return (t) => {
          const bell =
            (sine(1568, t) + sine(1045, t) * 0.85 + sine(785, t) * 0.45 + sine(3136, t) * 0.5 + sine(6360, t) * 0.5) *
            decay(t, 7.7)
          const knock = (sine(888, t) + sine(1333, t) * 0.7 + sine(1955, t) * 0.6) * decay(t, 30)
          // a little bright noise on top, like the original's sheen
          return bell * 0.55 + knock * 0.6 + sheen(noise(r), 6000) * decay(t, 8) * 0.9
        }
      },
    },
    // metallic shimmer: inharmonic partials, the 13.3 kHz one strongest, and a crack
    break: {
      seconds: 1.0,
      gain: 0.25,
      build: (r) => {
        const crack = highpass(0.3)
        const partials: [number, number, number][] = [
          [13288, 1, 3.4],
          [8155, 0.35, 4],
          [3517, 0.55, 3],
          [3044, 0.3, 5],
          [1328, 0.5, 4.5],
          [977, 0.25, 5],
        ]
        return (t) => {
          let sum = 0
          for (const [f, a, k] of partials) sum += sine(f, t) * a * decay(t, k)
          return sum + crack(noise(r)) * decay(t, 40) * 0.8
        }
      },
    },
    // short cluster around 1.0-2.2 kHz, then airy high noise
    touch: {
      seconds: 0.7,
      gain: 0.5,
      build: (r, rate) => {
        const air = bandpass(rate, 1.2)
        return (t) =>
          (sine(1377, t) + sine(1577, t) * 0.9 + sine(1977, t) * 0.9 + sine(1044, t) * 0.8 + sine(2177, t) * 0.6) *
            decay(t, 40) * 0.35 +
          air(noise(r), 14000) * Math.min(t / 0.035, 1) * decay(Math.max(t - 0.035, 0), 9) * 0.5
      },
    },
    // whoosh: band-passed noise whose centre drifts 7k -> 9.6k -> 5.2k, swelling in
    slide: {
      seconds: 1.6,
      gain: 0.9,
      build: (r, rate) => {
        const bp = bandpass(rate, 1.2)
        return (t) => {
          const centre = t < 0.25 ? 7000 + (2600 * t) / 0.25 : 9600 - 4400 * Math.min((t - 0.25) / 1.0, 1)
          const env = Math.min(t / 0.175, 1) * (t < 0.175 ? 1 : decay(t - 0.175, 2.6))
          return bp(noise(r), centre) * env
        }
      },
    },
    // burst, low boom, high crackle and a mid tail
    firework: {
      seconds: 3.2,
      gain: 0.45,
      build: (r, rate) => {
        const crackle = highpass(0.8)
        const tail = bandpass(rate, 1.5)
        return (t) =>
          (sine(1444, t) + sine(1733, t) + sine(3511, t) * 0.7 + sine(4244, t) * 0.5) * decay(t, 60) * 0.3 +
          Math.sin(TAU * 85 * t * (1 + 0.6 * decay(t, 6))) * Math.min(t / 0.13, 1) * decay(t, 1.3) * 0.9 +
          crackle(noise(r) * (r() < 0.03 ? 5 : 0.5)) * Math.min(t / 0.13, 1) * decay(t, 1.0) * 0.5 +
          tail(noise(r), 1100) * Math.min(t / 0.4, 1) * decay(t, 1.0) * 1.2
      },
    },
  },
}

export const HIT_SOUND_PRESETS: HitSoundPreset[] = [arcade, classic, wood, chip, crisp, marimba]
export const DEFAULT_HIT_SOUND_PRESET = 'classic'

export function findPreset(id: string): HitSoundPreset {
  return HIT_SOUND_PRESETS.find((p) => p.id === id) ?? classic
}
