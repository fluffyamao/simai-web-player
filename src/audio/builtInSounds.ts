// SPDX-License-Identifier: GPL-3.0-only
import type { HitSoundKind } from './hitSounds'
import { decodePack, type PackSound, type StoredFile } from './soundPack'

/** MajdataPlay NoteAudioManager roles, using the names in the user's B_full folder. */
export const BUILT_IN_FILES: Record<HitSoundKind, string> = {
  answer: 'answer.wav', tap: 'tap.wav', ex: 'ex.wav', break: 'break.wav',
  cheer: 'cheer.wav', touch: 'touch.wav', touchHold: 'touch_hold.wav',
  slide: 'slide.wav', breakSlide: 'break_slide.wav',
  breakSlideCheer: 'break_slide_cheer.wav', firework: 'firework.wav',
}
/** Where the B_full files are fetched from unless the player is told otherwise. */
export const DEFAULT_HIT_SOUND_BASE = '/hit-sounds/B_full/'
type Loaded = { sounds: PackSound[]; failed: string[] }
const cached = new Map<string, Promise<Loaded>>()

/** A single download/decode per folder and page, shared by player instances. No synthesis fallback. */
export function loadBuiltInSounds(base = DEFAULT_HIT_SOUND_BASE): Promise<Loaded> {
  const folder = base.endsWith('/') ? base : `${base}/`
  let loading = cached.get(folder)
  if (!loading) cached.set(folder, loading = (async () => {
    const files: StoredFile[] = []
    const failed: string[] = []
    await Promise.all(Object.entries(BUILT_IN_FILES).map(async ([kind, name]) => {
      try {
        const response = await fetch(`${folder}${name}`, { signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        files.push({ kind: kind as HitSoundKind, name, bytes: await response.arrayBuffer() })
      } catch { failed.push(name) }
    }))
    const decoded = await decodePack(files)
    const result = { sounds: decoded.sounds, failed: [...failed, ...decoded.failed] }
    if (result.failed.length) cached.delete(folder)
    return result
  })())
  return loading
}
