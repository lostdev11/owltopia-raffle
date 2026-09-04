'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { parseAdminRole } from '@/lib/admin/roles'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'

type AccessState = {
  /** True when viewer may use Owl Packs (public, SIWS admin, admin wallet, or test allowlist). */
  allowed: boolean
  /** Connected wallet (or session) resolved as admin. */
  isAdmin: boolean
  /** Connected wallet is on the pack test allowlist (restricted mode). */
  isTester: boolean
  /** Still resolving wallet/session checks. */
  loading: boolean
  /** Connected wallet checked and not allowed. */
  denied: boolean
  /** Access API failed (DB/TLS) — not the same as denied. */
  accessCheckError: string | null
  /** SIWS cookie session is an Owl Vision admin (works even if adapter disconnected). */
  adminSessionActive: boolean
  /** Force re-check after SIWS sign-in. */
  recheck: () => void
}

/**
 * Owl Packs access gate:
 * - public launch mode → everyone
 * - restricted → admin (SIWS/wallet) or test allowlist wallet
 * - env kill switch → admins only
 */
export function usePacksAdminAccess(params: {
  initialViewerIsAdmin: boolean
  isPublic: boolean
}): AccessState {
  const { initialViewerIsAdmin, isPublic } = params
  const { publicKey, connected } = useWallet()
  const visibilityTick = useVisibilityTick()
  const [manualTick, setManualTick] = useState(0)
  const wallet = publicKey?.toBase58() ?? ''
  const tick = visibilityTick + manualTick

  const [adminSessionActive, setAdminSessionActive] = useState(initialViewerIsAdmin)
  const [walletIsAdmin, setWalletIsAdmin] = useState<boolean | null>(() => {
    if (typeof window !== 'undefined' && wallet) {
      const cached = getCachedAdmin(wallet)
      if (cached !== null) return cached
    }
    return initialViewerIsAdmin ? true : null
  })
  const [walletIsTester, setWalletIsTester] = useState(false)
  const [accessCheckError, setAccessCheckError] = useState<string | null>(null)
  const [walletCheckPending, setWalletCheckPending] = useState(() => {
    if (isPublic) return false
    if (!connected || !wallet) return false
    return getCachedAdmin(wallet) === null && !initialViewerIsAdmin
  })

  const recheck = useCallback(() => {
    setManualTick((n) => n + 1)
  }, [])

  useEffect(() => {
    if (isPublic) return
    let cancelled = false
    fetch('/api/admin/check?session=1', { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (cancelled) return undefined
        return res.ok ? res.json() : undefined
      })
      .then((data) => {
        if (cancelled || data === undefined) return
        setAdminSessionActive(data?.isAdmin === true)
      })
      .catch(() => {
        /* keep prior session hint on transient errors */
      })
    return () => {
      cancelled = true
    }
  }, [isPublic, tick])

  useEffect(() => {
    if (isPublic) {
      setWalletCheckPending(false)
      setWalletIsTester(false)
      return
    }
    if (!connected || !publicKey) {
      setWalletIsAdmin(null)
      setWalletIsTester(false)
      setWalletCheckPending(false)
      setAccessCheckError(null)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null && manualTick === 0) {
      setWalletIsAdmin(cached)
      setWalletCheckPending(false)
    } else {
      setWalletCheckPending(true)
    }
    setAccessCheckError(null)

    let cancelled = false
    fetch(`/api/packs/access-check?wallet=${encodeURIComponent(addr)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (res) => {
        if (cancelled) return undefined
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setAccessCheckError(
            typeof data?.error === 'string'
              ? data.error
              : 'Could not reach the database to verify access (often Norton HTTPS scanning on local).'
          )
          // Keep prior cache if we already knew this wallet was admin.
          setWalletIsAdmin((prev) => (prev === true ? true : null))
          setWalletIsTester(false)
          return undefined
        }
        return data
      })
      .then((data) => {
        if (cancelled || data === undefined) return
        const admin = data?.isAdmin === true
        const tester = data?.isTester === true
        const role = admin ? parseAdminRole(data?.role) : null
        setCachedAdmin(addr, admin, role)
        setWalletIsAdmin(admin)
        setWalletIsTester(tester)
        setAccessCheckError(null)
      })
      .catch(() => {
        if (!cancelled) {
          setAccessCheckError(
            'Network error verifying Packs access. If you use Norton, turn off HTTPS scanning or set ALLOW_INSECURE_TLS=1 in .env.local for local only.'
          )
          setWalletIsAdmin((prev) => (prev === true ? true : null))
          setWalletIsTester(false)
        }
      })
      .finally(() => {
        if (!cancelled) setWalletCheckPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isPublic, tick, manualTick])

  const isAdmin =
    walletIsAdmin === true || adminSessionActive === true || initialViewerIsAdmin === true
  const isTester = walletIsTester === true
  const allowed = isPublic || isAdmin || isTester
  const denied =
    !isPublic &&
    connected &&
    Boolean(publicKey) &&
    !walletCheckPending &&
    accessCheckError == null &&
    walletIsAdmin === false &&
    !walletIsTester &&
    !adminSessionActive &&
    !initialViewerIsAdmin

  const loading =
    !isPublic &&
    !allowed &&
    !denied &&
    accessCheckError == null &&
    (walletCheckPending || Boolean(connected && publicKey && walletIsAdmin === null))

  return {
    allowed,
    isAdmin,
    isTester,
    loading,
    denied,
    accessCheckError,
    adminSessionActive,
    recheck,
  }
}
