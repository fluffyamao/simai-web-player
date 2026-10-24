// SPDX-License-Identifier: GPL-3.0-only
import type { SimaiPlayer } from '../player'

/**
 * Make a button move through the chart while it is held: e.g. rate 0.5 plays forwards at
 * half speed, -0.5 backwards. Works with mouse, touch, and Space/Enter on the focused button.
 *
 * @returns a function that detaches the button
 */
export function attachShuttleButton(player: SimaiPlayer, button: HTMLElement, rate: number): () => void {
  let holding = false
  const start = () => {
    if (holding) return
    holding = true
    player.startShuttle(rate)
  }
  const stop = () => {
    if (!holding) return
    holding = false
    player.stopShuttle()
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault() // keep touch from turning the press into a scroll or long-press menu
    try {
      button.setPointerCapture(e.pointerId)
    } catch {
      // synthetic events have no capturable pointer
    }
    start()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    if (!e.repeat) start()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return
    e.preventDefault()
    stop()
  }
  const noMenu = (e: Event) => e.preventDefault()

  button.addEventListener('pointerdown', onPointerDown)
  button.addEventListener('pointerup', stop)
  button.addEventListener('pointercancel', stop)
  button.addEventListener('lostpointercapture', stop)
  button.addEventListener('keydown', onKeyDown)
  button.addEventListener('keyup', onKeyUp)
  button.addEventListener('blur', stop)
  button.addEventListener('contextmenu', noMenu)
  return () => {
    stop()
    button.removeEventListener('pointerdown', onPointerDown)
    button.removeEventListener('pointerup', stop)
    button.removeEventListener('pointercancel', stop)
    button.removeEventListener('lostpointercapture', stop)
    button.removeEventListener('keydown', onKeyDown)
    button.removeEventListener('keyup', onKeyUp)
    button.removeEventListener('blur', stop)
    button.removeEventListener('contextmenu', noMenu)
  }
}
