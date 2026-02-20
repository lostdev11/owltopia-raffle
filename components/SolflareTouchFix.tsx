'use client'

import { useEffect } from 'react'

const INTERACTIVE_SELECTOR =
  'button, [role="button"], a[href], .wallet-adapter-button, .wallet-connect-wrapper, [class*="wallet-adapter"] button, .wallet-adapter-modal-list li, .wallet-adapter-modal-list .wallet-adapter-button, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], select'

/**
 * On mobile (including Solflare in-app browser), many WebViews don't reliably
 * translate touch to click. We add a touchend->click fallback for interactive
 * elements so the connect button and wallet modal options (e.g. Solflare) work.
 * Applies to all mobile so we don't depend on Solflare-specific UA.
 */
export function SolflareTouchFix() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return
    const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase()
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)
    const isSolflare = ua.includes('solflare')

    if (isSolflare) {
      document.body.classList.add('solflare-browser')
    }
    if (isMobile) {
      document.body.classList.add('mobile-wallet-context')
      // Touch->click fallback for ALL mobile (Solflare in-app and others). Many WebViews
      // don't fire click from touch; dispatching a synthetic click on touchend fixes it.
      const onTouchEnd = (e: TouchEvent) => {
        const target = e.target as HTMLElement
        let el = target?.closest?.(INTERACTIVE_SELECTOR) as HTMLElement | null
        if (!el || (el as HTMLButtonElement).disabled) return
        // If we hit a list item (wallet option), trigger the button inside so the adapter's handler runs
        if (el.tagName === 'LI' && el.closest?.('.wallet-adapter-modal-list')) {
          const btn = el.querySelector?.('button')
          if (btn && !(btn as HTMLButtonElement).disabled) el = btn as HTMLElement
        }
        const synthetic = document.createEvent('MouseEvents')
        synthetic.initMouseEvent('click', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
        setTimeout(() => el.dispatchEvent(synthetic), 0)
      }
      document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
      return () => document.removeEventListener('touchend', onTouchEnd, { capture: true })
    }
  }, [])
  return null
}
