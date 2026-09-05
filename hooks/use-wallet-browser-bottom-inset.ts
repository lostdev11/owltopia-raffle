'use client'

import { useEffect, useState } from 'react'
import { isMobileWalletInjectedContext } from '@/lib/utils'

/** Phantom / Solflare bottom URL bars sit outside safe-area; typical overlay height. */
const WALLET_BROWSER_CHROME_FALLBACK_PX = 72

function measureBottomInset(): number {
  if (typeof window === 'undefined') return 0

  const vv = window.visualViewport
  if (vv) {
    const fromViewport = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    if (fromViewport > 0) return fromViewport
  }

  // Wallet WebViews often draw chrome over the page without shrinking visualViewport.
  if (isMobileWalletInjectedContext()) return WALLET_BROWSER_CHROME_FALLBACK_PX
  return 0
}

/**
 * Extra bottom offset for fixed CTAs inside mobile wallet in-app browsers (Phantom URL bar, etc.).
 */
export function useWalletBrowserBottomInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const update = () => setInset(measureBottomInset())
    update()

    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return inset
}

/** `bottom` for fixed elements: safe-area + wallet chrome. */
export function fixedBottomWithWalletInset(insetPx: number, baseRem = 2): string {
  return `calc(max(${baseRem}rem, env(safe-area-inset-bottom, 0px)) + ${insetPx}px)`
}

/** `padding-bottom` for footers: safe-area + wallet chrome. */
export function paddingBottomWithWalletInset(insetPx: number, baseRem = 1.25): string {
  return `calc(max(${baseRem}rem, env(safe-area-inset-bottom, 0px)) + ${insetPx}px)`
}
