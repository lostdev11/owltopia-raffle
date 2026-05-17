'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  isAndroidOrSolanaMobileClient,
  isLikelySeekerDevice,
  isSolanaMobileWebShell,
} from '@/lib/utils'

const ANDROID_TIPS_DISMISSED_KEY = 'owl_android_wallet_tips_dismissed'
const POLL_MS = 5 * 60_000

const CLIENT_BUILD_ID =
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_APP_BUILD_ID?.trim() || 'local' : 'local'

function reloadForFreshBuild() {
  if (typeof window === 'undefined') return
  window.location.reload()
}

function BannerShell({
  role,
  className,
  children,
}: {
  role: 'alert' | 'status'
  className: string
  children: React.ReactNode
}) {
  return (
    <div role={role} aria-live={role === 'status' ? 'polite' : undefined} className={className}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 max-w-6xl mx-auto w-full">
        {children}
      </div>
    </div>
  )
}

export function MobileClientUpdateBanner() {
  const [mounted, setMounted] = useState(false)
  const [staleBuild, setStaleBuild] = useState(false)
  const [serverBuildId, setServerBuildId] = useState<string | null>(null)
  const [showAndroidTips, setShowAndroidTips] = useState(false)

  const isMobileClient = useMemo(() => {
    if (!mounted) return false
    return isAndroidOrSolanaMobileClient()
  }, [mounted])

  const androidTipsLine = useMemo(() => {
    if (!mounted) return null
    if (isSolanaMobileWebShell() || isLikelySeekerDevice()) {
      return (
        <>
          On <strong>Seeker</strong>, keep system updates and Seed Vault current. After we ship a site update,
          pull down to refresh or reopen this page. Use <strong>Solana Mobile</strong> in the wallet list to connect.
        </>
      )
    }
    if (isAndroidOrSolanaMobileClient()) {
      return (
        <>
          On <strong>Android</strong>, update Chrome and your wallet app (Phantom, Solflare, etc.). If connect or sign
          fails, refresh this page or open it in your wallet&apos;s in-app browser.
        </>
      )
    }
    return null
  }, [mounted])

  const checkBuild = useCallback(async () => {
    if (!isAndroidOrSolanaMobileClient()) return
    try {
      const res = await fetch('/api/app-build', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { buildId?: string }
      const remote = typeof data.buildId === 'string' ? data.buildId.trim() : ''
      if (!remote) return
      setServerBuildId(remote)
      if (remote !== CLIENT_BUILD_ID && CLIENT_BUILD_ID !== 'dev' && CLIENT_BUILD_ID !== 'local') {
        setStaleBuild(true)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || !isMobileClient) return

    let dismissed = false
    try {
      dismissed = sessionStorage.getItem(ANDROID_TIPS_DISMISSED_KEY) === '1'
    } catch {
      /* ignore */
    }
    if (!dismissed && androidTipsLine) {
      setShowAndroidTips(true)
    }

    void checkBuild()
    const id = setInterval(() => void checkBuild(), POLL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkBuild()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [mounted, isMobileClient, androidTipsLine, checkBuild])

  const dismissAndroidTips = useCallback(() => {
    setShowAndroidTips(false)
    try {
      sessionStorage.setItem(ANDROID_TIPS_DISMISSED_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  if (!mounted || !isMobileClient) return null
  if (!staleBuild && !showAndroidTips) return null

  if (staleBuild) {
    return (
      <BannerShell
        role="alert"
        className={cn(
          'sticky top-0 z-[99] w-full border-b border-sky-500/50',
          'bg-gradient-to-r from-sky-950 via-sky-900 to-sky-950 text-sky-50',
          'shadow-md touch-manipulation',
          'pt-[max(0.375rem,env(safe-area-inset-top,0px))]'
        )}
      >
        <p className="text-sm font-medium leading-snug flex-1 min-w-0">
          A newer version of this site is available
          {serverBuildId ? (
            <span className="block text-xs font-normal text-sky-200/90 mt-0.5">
              Your tab may be on an older build — refresh so wallet connect and checkout stay in sync.
            </span>
          ) : null}
        </p>
        <Button
          type="button"
          size="sm"
          className="shrink-0 min-h-11 touch-manipulation bg-sky-100 text-sky-950 hover:bg-white"
          onClick={reloadForFreshBuild}
        >
          Refresh now
        </Button>
      </BannerShell>
    )
  }

  if (!showAndroidTips || !androidTipsLine) return null

  return (
    <BannerShell
      role="status"
      className={cn(
        'sticky top-0 z-[98] w-full border-b border-emerald-500/35',
        'bg-gradient-to-r from-emerald-950/95 via-slate-900 to-emerald-950/95 text-emerald-50',
        'shadow-sm touch-manipulation',
        'pt-[max(0.375rem,env(safe-area-inset-top,0px))]'
      )}
    >
      <p className="text-sm leading-snug flex-1 min-w-0">{androidTipsLine}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 min-h-11 touch-manipulation border-emerald-500/40 text-emerald-50 hover:bg-emerald-900/50"
        onClick={dismissAndroidTips}
      >
        Got it
      </Button>
    </BannerShell>
  )
}
