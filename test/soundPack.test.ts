import { describe, expect, it } from 'vitest'
import { assignFiles, matchKind, soundStart } from '../src/audio/soundPack'

describe('sound pack file names', () => {
  it('recognises arcade-style and MajdataPlay-style names', () => {
    expect(matchKind('tap.wav')?.kind).toBe('tap')
    expect(matchKind('TAP_PERFECT.WAV')?.kind).toBe('tap')
    expect(matchKind('pack/tap_ex.ogg')?.kind).toBe('ex')
    expect(matchKind('touch_hanabi.wav')?.kind).toBe('firework')
    expect(matchKind('break_slide.wav')?.kind).toBe('breakSlide')
    expect(matchKind('slide_break_start.wav')?.kind).toBe('breakSlide')
    expect(matchKind('answer.mp3')?.kind).toBe('answer')
  })

  it('ignores other files', () => {
    expect(matchKind('tap.txt')).toBeNull()
    expect(matchKind('bgm_title.mp3')).toBeNull()
    expect(matchKind('tap_great.wav')).toBeNull()
  })

  it('prefers the best name when several match', () => {
    const files = [{ name: 'break_tap.wav' }, { name: 'break.wav' }, { name: 'tap_perfect.wav' }, { name: 'tap.wav' }]
    const chosen = assignFiles(files)
    expect(chosen.get('break')?.name).toBe('break.wav')
    expect(chosen.get('tap')?.name).toBe('tap.wav')
    expect(chosen.size).toBe(2)
  })
})

describe('soundStart', () => {
  it('skips leading silence, keeping 1 ms before the sound', () => {
    const rate = 48000
    const x = new Float32Array(rate / 2)
    const at = Math.round(rate * 0.05) // the arcade files start after 50 ms
    for (let i = at; i < x.length; i++) x[i] = 0.5 * Math.exp(-(i - at) / 2000) * Math.sin(i / 3 + 0.5)
    const start = soundStart([x], rate)
    expect(start).toBeGreaterThanOrEqual(at - 48 - 2)
    expect(start).toBeLessThanOrEqual(at)
  })

  it('keeps sounds that start right away, and silence as is', () => {
    expect(soundStart([new Float32Array([0.9, 0.5, 0.1])], 48000)).toBe(0)
    expect(soundStart([new Float32Array(100)], 48000)).toBe(0)
  })
})
