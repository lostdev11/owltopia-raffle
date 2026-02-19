'use client'

import { useEffect } from 'react'

/**
 * Detects Solflare in-app browser (mobile) and adds a body class so CSS can
 * apply touch/pointer fixes. In Solflare's WebView, click events sometimes
 * don't fire from touch; the Button component also uses onPointerUp as fallback.
 */
export function SolflareTouchFix() {
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const ua = navigator.userAgent || ''
    if (ua.toLowerCase().includes('solflare')) {
      document.body.classList.add('solflare-browser')
    }
  }, [])
  return null
}
