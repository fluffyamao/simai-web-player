import { describe, expect, it } from 'vitest'
import { parseMaidata } from '../src/parser/maidata'
import { parseSimai } from '../src/parser/simai'

describe('parseMaidata', () => {
  it('reads metadata and multi-line charts', () => {
    const md = parseMaidata('&title=Song\r\n&first=1.5\n&lv_5=13+\n&inote_5=(120)\n1,2,\nE\n&inote_2=\n')
    expect(md.title).toBe('Song')
    expect(md.first).toBe(1.5)
    expect(md.difficulties).toHaveLength(1)
    expect(md.difficulties[0]).toMatchObject({ index: 5, level: '13+', chart: '(120)\n1,2,\nE' })
  })
})

describe('parseSimai', () => {
  it('times taps from bpm and subdivision', () => {
    const c = parseSimai('(120){4}1,2,{8}3,4,E')
    expect(c.notes.map((n) => n.time)).toEqual([0, 0.5, 1, 1.25])
    expect(c.endTime).toBe(1.5)
    expect(c.errors).toEqual([])
  })

  it('supports {#seconds} steps', () => {
    const c = parseSimai('(120){#0.1}1,,2')
    expect(c.notes[1]!.time).toBeCloseTo(0.2)
  })

  it('reads each notes, shorthand and pseudo each', () => {
    const c = parseSimai('(120)1/5,26,3`4,')
    expect(c.notes.map((n) => [n.time, n.isEach])).toEqual([
      [0, true], [0, true], [0.5, true], [0.5, true], [1, false], [1, false],
    ])
  })

  it('reads holds, breaks and ex', () => {
    const c = parseSimai('(120)1h[4:1],2bx,3h[#1.5],4h[60#4:1],Ch[2:1],5bh[8:1]')
    const [h, b, h2, h3, th, bh] = c.notes
    expect(h).toMatchObject({ kind: 'hold', length: 0.5 })
    expect(b).toMatchObject({ kind: 'tap', isBreak: true, isEx: true })
    expect(h2!.length).toBe(1.5)
    expect(h3!.length).toBe(1)
    expect(th).toMatchObject({ kind: 'touchHold', length: 1, location: { group: 'C' } })
    expect(bh).toMatchObject({ kind: 'hold', isBreak: true, length: 0.25 })
  })

  it('reads touches', () => {
    const c = parseSimai('(120)A1/B8f/C1/E3,')
    expect(c.notes.map((n) => n.location)).toEqual([
      { group: 'A', index: 1 }, { group: 'B', index: 8 }, { group: 'C', index: 1 }, { group: 'E', index: 3 },
    ])
    expect(c.notes[1]!.isFirework).toBe(true)
  })

  it('reads slides with timing variants', () => {
    const c = parseSimai('(120)1-5[4:1],2qq6[160#8:3]*-4[2##1.5],3?V71[8:1]b,4>8[8:1]-2[8:1]')
    const [a, b, d, e] = c.notes
    expect(a!.slides[0]).toMatchObject({ delay: 0.5, duration: 0.5, segments: [{ shape: '-', vertices: [5] }] })
    expect(b!.slides).toHaveLength(2)
    expect(b!.slides[0]!.segments[0]!.shape).toBe('qq')
    expect(b!.slides[0]!.delay).toBeCloseTo(60 / 160)
    expect(b!.slides[0]!.duration).toBeCloseTo((240 / 160 / 8) * 3)
    expect(b!.slides[1]).toMatchObject({ delay: 2, duration: 1.5 })
    expect(d).toMatchObject({ head: 'none' })
    expect(d!.slides[0]).toMatchObject({ isBreak: true, segments: [{ shape: 'V', vertices: [7, 1] }] })
    expect(e!.slides[0]!.segments).toHaveLength(2)
    expect(e!.slides[0]!.duration).toBe(0.5)
  })

  it('reads hi-speed tags', () => {
    const c = parseSimai('(120)1,<HS*1.5>2,<SV*2>3,<HS*-1>4,')
    expect(c.notes.map((n) => n.hspeed)).toEqual([1, 1.5, 1.5, -1])
    expect(c.errors).toEqual([])
  })

  it('skips comments and hi-speed tags, and reports bad input', () => {
    const c = parseSimai('(120)1,|| comment\n<HS*1.5>2,9,')
    expect(c.notes).toHaveLength(2)
    expect(c.errors).toHaveLength(1)
    expect(c.errors[0]!.line).toBe(2)
  })
})
