import { describe, expect, it } from 'vitest'
import { parseSlideText } from '../src/slideText'
import { slideTrack } from '../src/render/slides'

describe('slide text', () => {
  it('reads single, grand V, connected and wifi slides', () => {
    expect(parseSlideText('1-5')?.slide.segments).toEqual([{ shape: '-', vertices: [5] }])
    expect(parseSlideText(' 1V75 ')?.slide.segments).toEqual([{ shape: 'V', vertices: [7, 5] }])
    expect(parseSlideText('1-3-5')?.slide.segments).toHaveLength(2)
    expect(parseSlideText('3w7')?.start).toBe(3)
  })

  it('rejects anything that is not one slide', () => {
    expect(parseSlideText('')).toBeNull()
    expect(parseSlideText('A1')).toBeNull()
    expect(parseSlideText('1-5,2-6')).toBeNull()
    expect(parseSlideText('1')).toBeNull()
  })

  it('gives a track line per segment, three for wifi', () => {
    expect(slideTrack(1, parseSlideText('1-3-5')!.slide)).toHaveLength(2)
    expect(slideTrack(1, parseSlideText('1w5')!.slide)).toHaveLength(3)
  })
})
