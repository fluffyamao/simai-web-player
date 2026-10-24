// SPDX-License-Identifier: GPL-3.0-only
import { parseSimai } from './parser/simai'
import type { SlidePath } from './parser/types'

/** Read one slide written as in simai, e.g. "1-5", "1V75", "1-3-5" or "1w5". */
export function parseSlideText(text: string): { start: number; slide: SlidePath } | null {
  const t = text.trim()
  if (!/^[1-8][-<>^vVpqszw0-9]+$/.test(t)) return null
  const chart = parseSimai(`(120)${t}[4:1],`)
  const note = chart.notes[0]
  const slide = note?.slides[0]
  if (!note || !slide || note.location.group !== 'button' || chart.errors.length) return null
  return { start: note.location.index, slide }
}
