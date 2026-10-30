import { describe, expect, it } from 'vitest'
import { BUILT_IN_FILES } from '../src/audio/builtInSounds'
import { DEFAULT_HIT_SOUND_PRESET, HIT_SOUND_PRESETS, findPreset } from '../src/audio/presets'

describe('B_full sample pack', () => {
  it('is the only built-in set, including when a legacy preference is restored', () => {
    expect(HIT_SOUND_PRESETS).toEqual([{ id: 'b-full', name: 'B_full' }])
    for (const old of ['classic', 'wood', 'arcade', 'chip', 'crisp', 'marimba', 'unknown']) {
      expect(findPreset(old).id).toBe(DEFAULT_HIT_SOUND_PRESET)
    }
  })

  it('maps all eleven files with distinct BREAK and continuous touch-hold roles', () => {
    expect(new Set(Object.values(BUILT_IN_FILES)).size).toBe(11)
    expect(BUILT_IN_FILES.break).toBe('break.wav')
    expect(BUILT_IN_FILES.cheer).toBe('cheer.wav')
    expect(BUILT_IN_FILES.breakSlide).toBe('break_slide.wav')
    expect(BUILT_IN_FILES.breakSlideCheer).toBe('break_slide_cheer.wav')
    expect(BUILT_IN_FILES.touchHold).toBe('touch_hold.wav')
  })
})
