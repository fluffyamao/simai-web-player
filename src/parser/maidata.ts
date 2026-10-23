// SPDX-License-Identifier: GPL-3.0-only
import type { Difficulty, Maidata } from './types'

/**
 * Split a maidata.txt into its `&key=value` fields.
 * A value runs until the next line that starts with `&`, so charts can span many lines.
 */
export function parseMaidata(text: string): Maidata {
  const meta: Record<string, string> = {}
  let key: string | null = null
  let value: string[] = []
  const flush = () => {
    if (key !== null) meta[key] = value.join('\n').trim()
  }

  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^&([^=]+)=(.*)$/.exec(line)
    if (m) {
      flush()
      key = m[1]!.trim()
      value = [m[2]!]
    } else if (key !== null) {
      value.push(line)
    }
  }
  flush()

  const difficulties: Difficulty[] = []
  for (const k of Object.keys(meta)) {
    const m = /^inote_(\d+)$/.exec(k)
    if (!m) continue
    const index = Number(m[1])
    const chart = meta[k]!
    if (!chart.trim()) continue
    const first = parseFloat(meta[`first_${index}`] ?? '')
    difficulties.push({
      index,
      level: meta[`lv_${index}`] || undefined,
      designer: meta[`des_${index}`] || meta.des || undefined,
      chart,
      first: Number.isFinite(first) ? first : undefined,
    })
  }
  difficulties.sort((a, b) => a.index - b.index)

  const first = parseFloat(meta.first ?? '')
  return {
    title: meta.title ?? '',
    artist: meta.artist ?? '',
    first: Number.isFinite(first) ? first : 0,
    meta,
    difficulties,
  }
}

export const DIFFICULTY_NAMES: Record<number, string> = {
  1: 'Easy',
  2: 'Basic',
  3: 'Advanced',
  4: 'Expert',
  5: 'Master',
  6: 'Re:Master',
  7: 'Utage',
}
