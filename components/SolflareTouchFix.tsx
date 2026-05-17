'use client'

import { useEffect } from 'react'
import { isMobileDevice } from '@/lib/utils'

const INTERACTIVE_SELECTOR =
  'button, [role="button"], a[href], .wallet-adapter-button, .wallet-connect-wrapper, [class*="wallet-adapter"] button, .wallet-adapter-modal-list li, .wallet-adapter-modal-list .wallet-adapter-button, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], input[role="switch"], select'

/** Match RaffleCard / featured card: ignore synthetic click after a scroll-like move */
const TAP_MOVE_THRESHOLD_PX = 12
const NATIVE_CLICK_WAIT_MS = 300

/**
 * On mobile (including Solflare in-app browser), many WebViews don't reliably
 * translate touch to click. We add a touchend->click fallback for interactive
 * elements so the connect button and wallet modal options (e.g. Solflare) work.
 * Uses isMobileDevice() so mobile behavior is consistent across the app.
 *
 * Gestures that moved past TAP_MOVE_THRESHOLD_PX are treated as scroll/drag so we
 * do not dispatch a synthetic click — otherwise scrolling starting on large `a[href]`
 * cards opens the link (same issue as local handlers on RaffleCard).
 */
export function SolflareTouchFix() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return
    const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase()
    const isMobile = isMobileDevice()
    const isSolflare = ua.includes('solflare')

    if (isSolflare) {
      document.body.classList.add('solflare-browser')
    }
    if (isMobile) {
      document.body.classList.add('mobile-wallet-context')
      // Touch->click fallback for ALL mobile (Solflare in-app and others). Many WebViews
      // don't fire click from touch; dispatching a synthetic click on touchend fixes it.
      const gesture = {
        startX: 0,
        startY: 0,
        tracking: false,
        movedPastThreshold: false,
      }
      let fallbackClickTimer: number | null = null
      let dispatchingFallbackClick = false

      const clearFallbackClick = () => {
        if (fallbackClickTimer == null) return
        window.clearTimeout(fallbackClickTimer)
        fallbackClickTimer = null
      }

      const onTouchStart = (e: TouchEvent) => {
        clearFallbackClick()
        if (e.touches.length !== 1) {
          gesture.tracking = false
          return
        }
        const t = e.touches[0]
        gesture.startX = t.clientX
        gesture.startY = t.clientY
        gesture.tracking = true
        gesture.movedPastThreshold = false
      }

      const onTouchMove = (e: TouchEvent) => {
        if (!gesture.tracking || e.touches.length !== 1) return
        const t = e.touches[0]
        if (
          Math.hypot(t.clientX - gesture.startX, t.clientY - gesture.startY) >
          TAP_MOVE_THRESHOLD_PX
        ) {
          gesture.movedPastThreshold = true
        }
      }

      const onTouchCancel = () => {
        gesture.tracking = false
        gesture.movedPastThreshold = false
        clearFallbackClick()
      }

      const onNativeClick = () => {
        if (dispatchingFallbackClick) return
        clearFallbackClick()
      }

      const onTouchEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        if (!t) return

        const wasTracking = gesture.tracking
        gesture.tracking = false

        if (!wasTracking || gesture.movedPastThreshold) return
        if (
          Math.hypot(t.clientX - gesture.startX, t.clientY - gesture.startY) >
          TAP_MOVE_THRESHOLD_PX
        ) {
          return
        }

        const target = e.target as HTMLElement
        // Native checkboxes/radios already get reliable change events from touch; a delayed
        // synthetic click here often toggles twice (checked → unchecked) on mobile wallets.
        if (target?.closest?.('input[type="checkbox"], input[type="radio"]')) return
        let el = target?.closest?.(INTERACTIVE_SELECTOR) as HTMLElement | null
        if (!el || (el as HTMLButtonElement).disabled) return
        // If we hit a list item (wallet option), trigger the button inside so the adapter's handler runs
        if (el.tagName === 'LI' && el.closest?.('.wallet-adapter-modal-list')) {
          const btn = el.querySelector?.('button')
          if (btn && !(btn as HTMLButtonElement).disabled) el = btn as HTMLElement
        }
        clearFallbackClick()
        fallbackClickTimer = window.setTimeout(() => {
          fallbackClickTimer = null
          if (!document.contains(el) || (el as HTMLButtonElement).disabled) return
          const synthetic = document.createEvent('MouseEvents')
          synthetic.initMouseEvent('click', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
          dispatchingFallbackClick = true
          try {
            el.dispatchEvent(synthetic)
          } finally {
            dispatchingFallbackClick = false
          }
        }, NATIVE_CLICK_WAIT_MS)
      }

      const cap = { passive: true, capture: true } as const
      document.addEventListener('touchstart', onTouchStart, cap)
      document.addEventListener('touchmove', onTouchMove, cap)
      document.addEventListener('touchcancel', onTouchCancel, cap)
      document.addEventListener('touchend', onTouchEnd, cap)
      document.addEventListener('click', onNativeClick, true)
      return () => {
        clearFallbackClick()
        document.removeEventListener('touchstart', onTouchStart, cap)
        document.removeEventListener('touchmove', onTouchMove, cap)
        document.removeEventListener('touchcancel', onTouchCancel, cap)
        document.removeEventListener('touchend', onTouchEnd, cap)
        document.removeEventListener('click', onNativeClick, true)
      }
    }
  }, [])
  return null
}
