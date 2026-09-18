'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { buildSyncedBrowserUrl } from '@/lib/client/browser-url-sync'
import { replaceClientUrl } from '@/lib/client/replace-url'

/**
 * Keeps the browser address bar aligned with App Router navigation.
 *
 * Soft navigations can leave the bar on the previous path (copy-link / share
 * then copies the wrong URL). When pathname drifts, force a shallow sync that
 * preserves Next's `__NA` history state via replaceClientUrl.
 */
export function BrowserUrlSync() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (typeof window === 'undefined' || !pathname) return
    const next = buildSyncedBrowserUrl({
      routerPathname: pathname,
      routerSearch: searchParams.toString(),
      browserPathname: window.location.pathname,
    })
    if (next) replaceClientUrl(next)
  }, [pathname, searchParams])

  return null
}
