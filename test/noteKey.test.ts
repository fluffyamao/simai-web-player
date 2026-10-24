import { expect, it } from 'vitest'
import { noteKey } from '../src/core/noteKey'
import { parseSimai } from '../src/parser/simai'

it('names notes by time and place', () => {
  const c = parseSimai('(120)1/A3,Ch[4:1],2-6[4:1],')
  expect(c.notes.map(noteKey)).toEqual(['0:1', '0:A3', '500:C', '1000:2'])
  // stable across parses
  expect(parseSimai('(120)1/A3,Ch[4:1],2-6[4:1],').notes.map(noteKey)).toEqual(c.notes.map(noteKey))
})
