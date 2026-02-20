'use client'

import { useEffect } from 'react'

/**
 * Detects Solflare in-app browser (mobile) and adds body classes so CSS can
 * apply touch/pointer fixes. In Solflare's WebView, click events sometimes
 * don't fire from touch; the Button component also uses onPointerUp as fallback.
 * Also adds a generic mobile class for touch-friendly styles across all mobile wallets.
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
    }
  }, [])
  return null
}
