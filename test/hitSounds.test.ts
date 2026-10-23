import { describe, expect, it } from 'vitest'
import { hitSoundEvents } from '../src/audio/hitSounds'
import { parseSimai } from '../src/parser/simai'

const events = (chart: string, fireworks = true) =>
  hitSoundEvents(parseSimai(chart).notes.map((note) => ({ note, time: note.time + 1 })), fireworks)

describe('hitSoundEvents', () => {
  it('plays one sound per kind per moment, in audio time', () => {
    expect(events('(120)1/5,2b,')).toEqual([
      { time: 1, kind: 'tap' },
      { time: 1.5, kind: 'break' },
    ])
  })

  it('adds slide starts and skips missing heads and mines', () => {
    expect(events('(120)1-5[4:1],2?-6[4:1],3m,').map((e) => [e.time, e.kind])).toEqual([
      [1, 'tap'],
      [1.5, 'slide'],
      [2, 'slide'],
    ])
  })

  it('fires fireworks at the end of a touch hold, only when enabled', () => {
    expect(events('(120)Chf[4:1],').map((e) => e.kind)).toEqual(['touch', 'firework'])
    expect(events('(120)Chf[4:1],')[1]!.time).toBe(1.5)
    expect(events('(120)Cf,', false).map((e) => e.kind)).toEqual(['touch'])
  })
})
