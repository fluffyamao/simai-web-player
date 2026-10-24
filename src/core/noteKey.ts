// SPDX-License-Identifier: GPL-3.0-only
import type { Note } from '../parser/types'

/**
 * A stable name for a note: its chart time in ms and where it is, e.g. "20000:3" for a tap
 * on button 3, "20000:A3" or "20000:C" for touches. Two notes never share both.
 */
export function noteKey(note: Note): string {
  const l = note.location
  const at = l.group === 'button' ? String(l.index) : l.group === 'C' ? 'C' : `${l.group}${l.index}`
  return `${Math.round(note.time * 1000)}:${at}`
}
