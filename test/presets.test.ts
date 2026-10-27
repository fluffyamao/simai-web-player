import { describe, expect, it } from 'vitest'
import { renderSound, type HitSoundKind } from '../src/audio/hitSounds'
import { HIT_SOUND_PRESETS, findPreset, soundFor } from '../src/audio/presets'

const RATE = 44100
const CORE: HitSoundKind[] = ['tap', 'break', 'touch', 'slide', 'firework']
const ALL: HitSoundKind[] = ['answer', 'tap', 'ex', 'break', 'touch', 'slide', 'breakSlide', 'firework']
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

describe('hit sound presets', () => {
  it('have unique ids and every sound', () => {
    expect(new Set(HIT_SOUND_PRESETS.map((p) => p.id)).size).toBe(HIT_SOUND_PRESETS.length)
    for (const p of HIT_SOUND_PRESETS) for (const k of CORE) expect(p.sounds[k]).toBeDefined()
    // ex and break slide fall back to tap and slide; answer only where a set has one
    expect(soundFor(findPreset('classic'), 'ex')).toBe(findPreset('classic').sounds.tap)
    expect(soundFor(findPreset('classic'), 'answer')).toBeUndefined()
    expect(soundFor(findPreset('arcade'), 'answer')).toBeDefined()
    expect(findPreset('nope').id).toBe('classic')
  })

  for (const preset of HIT_SOUND_PRESETS) {
    describe(preset.name, () => {
      for (const kind of ALL.filter((k) => preset.sounds[k])) {
        it(`${kind} is audible, clean and starts on time`, () => {
          const x = renderSound(preset.sounds[kind]!, RATE)
          expect(peak(x)).toBeGreaterThan(0.05)
          // hardly any clipping
          expect(x.filter((v) => Math.abs(v) >= 0.999).length / x.length).toBeLessThan(0.005)
          // slides swell in on purpose; everything else must hit in the first 5 ms
          if (kind !== 'slide' && kind !== 'breakSlide') expect(peak(x.subarray(0, RATE * 0.005))).toBeGreaterThan(0.02)
          // ends silent (no click at the end)
          expect(Math.abs(x[x.length - 1]!)).toBeLessThan(0.01)
        })
      }

      it('is about as loud as the classic set', () => {
        // compare the first 100 ms, where a hit sound is heard; long quiet tails do not count
        const head = (x: Float32Array) => x.subarray(0, RATE * 0.1)
        for (const kind of ['tap', 'break', 'touch'] as const) {
          const ratio =
            rms(head(renderSound(preset.sounds[kind], RATE))) / rms(head(renderSound(findPreset('classic').sounds[kind], RATE)))
          expect(ratio).toBeGreaterThan(1 / 3)
          expect(ratio).toBeLessThan(3)
        }
      })
    })
  }
})
