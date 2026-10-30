// SPDX-License-Identifier: GPL-3.0-only
//
// User-supplied hit sound packs: the user picks their own sound files; they are decoded and
// kept only in this browser (IndexedDB), never uploaded or bundled.
import type { HitSoundKind } from './hitSounds'

/** File names (without extension) recognised for each sound, in order of preference. */
const NAMES: Record<HitSoundKind, string[]> = {
  answer: ['answer'],
  tap: ['tap', 'tap_perfect', 'judge'],
  ex: ['ex', 'tap_ex', 'judge_ex'],
  break: ['break', 'break_tap', 'judge_break'],
  cheer: ['cheer'],
  touch: ['touch'],
  touchHold: ['touch_hold', 'touch_hold_riser'],
  slide: ['slide'],
  breakSlide: ['break_slide_start', 'slide_break_start', 'break_slide'],
  breakSlideCheer: ['break_slide_cheer', 'slide_break_slide'],
  firework: ['firework', 'touch_hanabi', 'hanabi'],
}
const AUDIO_EXT = /\.(wav|ogg|mp3|m4a|aac|flac|opus)$/i

/** Which sound a file name stands for, and how preferred it is (lower is better). */
export function matchKind(fileName: string): { kind: HitSoundKind; rank: number } | null {
  if (!AUDIO_EXT.test(fileName)) return null
  const base = fileName.replace(/^.*[\\/]/, '').replace(AUDIO_EXT, '').toLowerCase().replace(/[\s-]+/g, '_')
  for (const kind of Object.keys(NAMES) as HitSoundKind[]) {
    const rank = NAMES[kind].indexOf(base)
    if (rank >= 0) return { kind, rank }
  }
  return null
}

/** Pick the best file for each sound from a list of names. */
export function assignFiles<T extends { name: string }>(files: T[]): Map<HitSoundKind, T> {
  const best = new Map<HitSoundKind, { file: T; rank: number }>()
  for (const file of files) {
    const m = matchKind(file.name)
    if (!m) continue
    const current = best.get(m.kind)
    if (!current || m.rank < current.rank) best.set(m.kind, { file, rank: m.rank })
  }
  return new Map([...best].map(([k, v]) => [k, v.file]))
}

/**
 * Index of the first sample that is part of the sound: game files often start with
 * silence (the arcade's start with 50 ms), which would make them late. Keeps 1 ms before.
 */
export function soundStart(channels: Float32Array[], sampleRate: number): number {
  let peak = 0
  for (const ch of channels) for (const v of ch) peak = Math.max(peak, Math.abs(v))
  if (peak === 0) return 0
  const threshold = peak * 0.02 // -34 dB below the peak
  const len = channels[0]?.length ?? 0
  for (let i = 0; i < len; i++) {
    for (const ch of channels) {
      if (Math.abs(ch[i]!) > threshold) return Math.max(0, i - Math.round(sampleRate * 0.001))
    }
  }
  return 0
}

export interface PackSound {
  kind: HitSoundKind
  /** Original file name, for showing the user. */
  name: string
  /** Samples per channel, already trimmed. */
  channels: Float32Array<ArrayBuffer>[]
  sampleRate: number
}

/** Decoding rate; the browser resamples to its output rate on playback. */
const DECODE_RATE = 48000

async function decode(bytes: ArrayBuffer): Promise<{ channels: Float32Array<ArrayBuffer>[]; sampleRate: number }> {
  const ctx = new OfflineAudioContext(1, 1, DECODE_RATE)
  const buffer = await ctx.decodeAudioData(bytes.slice(0))
  const channels = Array.from({ length: Math.min(buffer.numberOfChannels, 2) }, (_, i) => buffer.getChannelData(i))
  const start = soundStart(channels, buffer.sampleRate)
  return { channels: channels.map((c) => c.slice(start)), sampleRate: buffer.sampleRate }
}

export interface StoredFile {
  kind: HitSoundKind
  name: string
  bytes: ArrayBuffer
}

/** Decode stored or chosen files into playable sounds; files that fail to decode are skipped. */
export async function decodePack(files: StoredFile[]): Promise<{ sounds: PackSound[]; failed: string[] }> {
  const sounds: PackSound[] = []
  const failed: string[] = []
  for (const f of files) {
    try {
      const { channels, sampleRate } = await decode(f.bytes)
      sounds.push({ kind: f.kind, name: f.name, channels, sampleRate })
    } catch {
      failed.push(f.name)
    }
  }
  return { sounds, failed }
}

// ---------- storage (this browser only) ----------

const DB_NAME = 'simai-web-player'
const STORE = 'hitSoundPack'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'kind' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        t.oncomplete = () => {
          db.close()
          resolve(req ? req.result : undefined)
        }
        t.onerror = () => reject(t.error)
      }),
  )
}

/** Replace the stored pack. Storage errors (e.g. private browsing) are ignored. */
export async function savePack(files: StoredFile[]): Promise<void> {
  try {
    await tx('readwrite', (s) => {
      s.clear()
      for (const f of files) s.put(f)
    })
  } catch {
    // not persisted; the pack still works until the page is closed
  }
}

export async function loadStoredPack(): Promise<StoredFile[]> {
  try {
    return ((await tx<StoredFile[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFile[]>)) ?? []).filter(
      (f) => f && f.bytes,
    )
  } catch {
    return []
  }
}

export async function clearStoredPack(): Promise<void> {
  try {
    await tx('readwrite', (s) => {
      s.clear()
    })
  } catch {
    // nothing stored
  }
}
