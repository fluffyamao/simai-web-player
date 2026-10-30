// SPDX-License-Identifier: GPL-3.0-only
/** The website ships one user-provided sample pack. Old IDs resolve to this pack. */
export interface HitSoundPreset { id: string; name: string }
export const DEFAULT_HIT_SOUND_PRESET = 'b-full'
export const HIT_SOUND_PRESETS: HitSoundPreset[] = [{ id: DEFAULT_HIT_SOUND_PRESET, name: 'B_full' }]
export function findPreset(_id: string): HitSoundPreset { return HIT_SOUND_PRESETS[0]! }
