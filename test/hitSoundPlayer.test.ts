import { afterEach, describe, expect, it, vi } from 'vitest'
import { HitSoundPlayer, type HitSoundKind } from '../src/audio/hitSounds'

vi.mock('../src/audio/builtInSounds', () => ({ loadBuiltInSounds: async () => ({
  sounds: (['tap', 'touchHold', 'cheer'] as HitSoundKind[]).map((kind) => ({ kind, name: `${kind}.wav`, sampleRate: 48000, channels: [new Float32Array(48000 * 5)] })),
  failed: [],
}) }))

class FakeSource {
  buffer: unknown
  onended: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeContext {
  static sources: FakeSource[] = []
  currentTime = 10
  state = 'running'
  destination = {}
  createGain() { return { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() } }
  createBuffer(_channels: number, length: number, sampleRate: number) { return { duration: length / sampleRate, copyToChannel: vi.fn() } }
  createBufferSource() { const source = new FakeSource(); FakeContext.sources.push(source); return source }
  close = vi.fn()
}
afterEach(() => { vi.unstubAllGlobals(); FakeContext.sources = [] })

async function player() {
  vi.stubGlobal('AudioContext', FakeContext)
  const sound = new HitSoundPlayer()
  await sound.ready
  sound.unlock()
  return sound
}

describe('sample playback lifecycle', () => {
  it('replaces the previous audition and stops it when the settings window closes', async () => {
    const sound = await player()
    sound.preview('touchHold')
    await Promise.resolve()
    expect(FakeContext.sources).toHaveLength(1)
    sound.preview('tap')
    await Promise.resolve()
    expect(FakeContext.sources[0]!.stop).toHaveBeenCalledTimes(1)
    expect(FakeContext.sources).toHaveLength(2)
    sound.stopPreview()
    expect(FakeContext.sources[1]!.stop).toHaveBeenCalledTimes(1)
    sound.destroy()
  })

  it('keeps channel levels independent and changes already connected audio immediately', async () => {
    const sound = await player()
    sound.volume = 0.5
    sound.setKindVolume('tap', 0.25)
    sound.setKindVolume('cheer', 0.8)
    sound.setEvents([{ kind: 'tap', time: 1 }, { kind: 'cheer', time: 1 }])
    sound.update(1, true, 1)
    const tap = FakeContext.sources[0]!.connect.mock.calls[0]![0] as { gain: { value: number } }
    const cheer = FakeContext.sources[1]!.connect.mock.calls[0]![0] as { gain: { value: number } }
    expect(tap.gain.value).toBe(0.25)
    expect(cheer.gain.value).toBe(0.8)
    sound.setKindVolume('tap', 0)
    expect(tap.gain.value).toBe(0)
    expect(cheer.gain.value).toBe(0.8)
    expect(sound.volume).toBe(0.5)
    sound.setKindVolume('touchHold', 5)
    expect(sound.getKindVolume('touchHold')).toBe(1)
    sound.setKindVolume('tap', NaN)
    expect(sound.getKindVolume('tap')).toBe(0)
    sound.destroy()
  })

  it('resumes an active touch hold at its offset after seeking, without replaying past taps', async () => {
    const sound = await player()
    sound.setEvents([{ kind: 'touchHold', time: 2, duration: 3 }, { kind: 'tap', time: 2.5 }])
    sound.update(3, true, 1)
    expect(FakeContext.sources).toHaveLength(1)
    expect(FakeContext.sources[0]!.start).toHaveBeenCalledWith(10, 1, 2)
    sound.update(3.1, false, 1)
    expect(FakeContext.sources[0]!.stop).toHaveBeenCalled()
    sound.destroy()
  })

  it('ends held audio at release at reduced speed, and stops scheduled sources on reset', async () => {
    const sound = await player()
    sound.setEvents([{ kind: 'touchHold', time: 1, duration: 1 }])
    sound.update(1, true, 0.5)
    expect(FakeContext.sources[0]!.start).toHaveBeenCalledWith(10, 0, 2)
    sound.reset()
    expect(FakeContext.sources[0]!.stop).toHaveBeenCalled()
    sound.update(3, true, 1)
    expect(FakeContext.sources).toHaveLength(1)
    sound.destroy()
  })

  it('stops scheduled samples when disabled and uses the selected volume', async () => {
    const sound = await player()
    sound.volume = 0.25
    expect(sound.volume).toBe(0.25)
    sound.setEvents([{ kind: 'tap', time: 1 }, { kind: 'cheer', time: 1 }])
    sound.update(1, true, 1)
    expect(FakeContext.sources).toHaveLength(2)
    sound.enabled = false
    sound.update(1.01, true, 1)
    expect(FakeContext.sources.every((s) => s.stop.mock.calls.length === 1)).toBe(true)
    sound.destroy()
  })
})
