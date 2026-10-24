// SPDX-License-Identifier: GPL-3.0-only
import type { SimaiPlayer } from '../player'

export interface ProgressBarOptions {
  /**
   * Precision steps by how far the pointer is from the bar (px, vertically).
   * Default: full speed on the bar, 1/4 from 40px away, 1/16 from 120px away.
   */
  fineSteps?: { distance: number; factor: number }[]
  /** Called when the precision changes during a drag (1 = normal), and with null when the drag ends. */
  onFineChange?: (factor: number | null) => void
}

const DEFAULT_STEPS = [
  { distance: 120, factor: 1 / 16 },
  { distance: 40, factor: 1 / 4 },
]

/**
 * Drive a player from an <input type="range" min="0" max="1">.
 *
 * Dragging along the bar jumps anywhere quickly; moving the pointer up or down away from
 * the bar while still holding it slows the drag down for fine positioning. Keyboard
 * arrows on the bar still work. The bar is kept in sync with playback.
 *
 * @returns a function that detaches the bar
 */
export function attachProgressBar(
  player: SimaiPlayer,
  bar: HTMLInputElement,
  options: ProgressBarOptions = {},
): () => void {
  const steps = [...(options.fineSteps ?? DEFAULT_STEPS)].sort((a, b) => b.distance - a.distance)
  let drag: { pointerId: number; anchorX: number; anchorTime: number; factor: number } | null = null

  const factorAt = (y: number) => {
    const r = bar.getBoundingClientRect()
    const away = Math.max(0, Math.abs(y - (r.top + r.height / 2)) - r.height / 2)
    return steps.find((s) => away >= s.distance)?.factor ?? 1
  }
  const show = (time: number) => {
    if (player.duration > 0) bar.value = String(time / player.duration)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || player.duration <= 0) return
    e.preventDefault() // take over from the native slider
    bar.focus()
    try {
      bar.setPointerCapture(e.pointerId)
    } catch {
      // synthetic events have no capturable pointer
    }
    const r = bar.getBoundingClientRect()
    const time = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * player.duration
    player.beginScrub()
    player.scrubTo(time)
    show(time)
    drag = { pointerId: e.pointerId, anchorX: e.clientX, anchorTime: time, factor: 1 }
    options.onFineChange?.(1)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const factor = factorAt(e.clientY)
    const width = bar.getBoundingClientRect().width
    const current = drag.anchorTime + ((e.clientX - drag.anchorX) / width) * player.duration * drag.factor
    if (factor !== drag.factor) {
      // re-anchor so changing precision never makes the position jump
      drag = { ...drag, anchorX: e.clientX, anchorTime: current, factor }
      options.onFineChange?.(factor)
    }
    const time = Math.min(Math.max(current, 0), player.duration)
    player.scrubTo(time)
    show(time)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    drag = null
    player.endScrub()
    options.onFineChange?.(null)
  }

  // keyboard on the focused slider: native step, then settle
  const onInput = () => {
    if (drag) return
    player.scrubTo(Number(bar.value) * player.duration)
  }
  const onChange = () => {
    if (!drag) player.endScrub()
  }

  // stop the native slider from also following the pointer (we position the thumb ourselves)
  const blockNative = (e: Event) => e.preventDefault()

  const unsubscribe = player.onTime((t) => {
    if (!player.scrubbing) show(t)
  })

  bar.addEventListener('pointerdown', onPointerDown)
  bar.addEventListener('mousedown', blockNative)
  bar.addEventListener('touchstart', blockNative, { passive: false })
  bar.addEventListener('pointermove', onPointerMove)
  bar.addEventListener('pointerup', onPointerUp)
  bar.addEventListener('pointercancel', onPointerUp)
  bar.addEventListener('input', onInput)
  bar.addEventListener('change', onChange)
  return () => {
    unsubscribe()
    bar.removeEventListener('pointerdown', onPointerDown)
    bar.removeEventListener('mousedown', blockNative)
    bar.removeEventListener('touchstart', blockNative)
    bar.removeEventListener('pointermove', onPointerMove)
    bar.removeEventListener('pointerup', onPointerUp)
    bar.removeEventListener('pointercancel', onPointerUp)
    bar.removeEventListener('input', onInput)
    bar.removeEventListener('change', onChange)
  }
}
