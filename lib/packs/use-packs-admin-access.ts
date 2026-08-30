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

    let cancelled = false
    fetch(`/api/packs/access-check?wallet=${encodeURIComponent(addr)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((res) => {
        if (cancelled) return undefined
        return res.ok ? res.json() : undefined
      })
      .then((data) => {
        if (cancelled || data === undefined) return
        const admin = data?.isAdmin === true
        const tester = data?.isTester === true
        const role = admin ? parseAdminRole(data?.role) : null
        setCachedAdmin(addr, admin, role)
        setWalletIsAdmin(admin)
        setWalletIsTester(tester)
      })
      .catch(() => {
        /* do not clear access on network errors */
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
    walletIsAdmin === false &&
    !walletIsTester &&
    !adminSessionActive &&
    !initialViewerIsAdmin

  const loading =
    !isPublic &&
    !allowed &&
    !denied &&
    (walletCheckPending || Boolean(connected && publicKey && walletIsAdmin === null))

  return {
    allowed,
    isAdmin,
    isTester,
    loading,
    denied,
    adminSessionActive,
    recheck,
  }
}
