'use client'

import { useEffect } from 'react'

const INTERACTIVE_SELECTOR =
  'button, [role="button"], a[href], .wallet-adapter-button, .wallet-connect-wrapper, [class*="wallet-adapter"] button, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], select'

/**
 * Detects Solflare in-app browser (mobile) and adds body classes so CSS can
 * apply touch/pointer fixes. In Solflare's WebView, click events sometimes
 * don't fire from touch; we add touchEnd->click fallback so all buttons work.
 */
export function SolflareTouchFix() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return
    const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase()
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)
    const isSolflare = ua.includes('solflare')
    if (isSolflare) {
      document.body.classList.add('solflare-browser')
      // Solflare WebView sometimes doesn't translate touch to click; dispatch click on touchend for interactive elements
      const onTouchEnd = (e: TouchEvent) => {
        const target = e.target as HTMLElement
        const el = target?.closest?.(INTERACTIVE_SELECTOR)
        if (!el || (el as HTMLButtonElement).disabled) return
        const synthetic = document.createEvent('MouseEvents')
        synthetic.initMouseEvent('click', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
        setTimeout(() => el.dispatchEvent(synthetic), 0)
      }
      document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
      return () => document.removeEventListener('touchend', onTouchEnd, { capture: true })
    }
    if (isMobile) {
      document.body.classList.add('mobile-wallet-context')
    }
  }, [])
  return null
}
