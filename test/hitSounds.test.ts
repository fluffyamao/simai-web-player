import { describe, expect, it } from 'vitest'
import { hitSoundEvents } from '../src/audio/hitSounds'
import { parseSimai } from '../src/parser/simai'

const events = (chart: string, fireworks = true) =>
  hitSoundEvents(parseSimai(chart).notes.map((note) => ({ note, time: note.time + 1 })), fireworks)
const pairs = (chart: string, fireworks = true) => events(chart, fireworks).map((e) => [e.time, e.kind])

describe('hitSoundEvents', () => {
  it('plays an answer plus one sound per kind per moment, in audio time', () => {
    expect(events('(120)1/5,2b,')).toEqual([
      { time: 1, kind: 'answer' },
      { time: 1, kind: 'tap' },
      { time: 1.5, kind: 'answer' },
      { time: 1.5, kind: 'break' },
    ])
  })

  it('uses the ex sound for EX notes', () => {
    expect(pairs('(120)1x,')).toEqual([
      [1, 'answer'],
      [1, 'ex'],
    ])
  })

  it('adds an answer when a hold ends', () => {
    expect(pairs('(120)1h[4:1],')).toEqual([
      [1, 'answer'],
      [1, 'tap'],
      [1.5, 'answer'],
    ])
  })

  it('adds slide starts and skips missing heads and mines', () => {
    expect(pairs('(120)1-5[4:1],2?-6[4:1],3m,')).toEqual([
      [1, 'answer'],
      [1, 'tap'],
      [1.5, 'slide'],
      [2, 'slide'],
    ])
  })

  it('gives break slides their own start sound and a break at the end', () => {
    expect(pairs('(120)1-5[4:1]b,')).toEqual([
      [1, 'answer'],
      [1, 'tap'],
      [1.5, 'breakSlide'],
      [2, 'break'],
    ])
  })

  it('fires fireworks at the end of a touch hold, only when enabled', () => {
    expect(pairs('(120)Chf[4:1],')).toEqual([
      [1, 'answer'],
      [1, 'touch'],
      [1.5, 'answer'],
      [1.5, 'firework'],
    ])
    expect(events('(120)Cf,', false).map((e) => e.kind)).toEqual(['answer', 'touch'])
  })
})
