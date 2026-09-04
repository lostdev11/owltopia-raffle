'use client'

import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { parseAdminRole } from '@/lib/admin/roles'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'

type AccessState = {
  /** True when viewer may use OwlSwap (public flag, SIWS admin session, or connected admin wallet). */
  allowed: boolean
  /** Connected wallet (or session) resolved as admin. */
  isAdmin: boolean
  /** Still resolving wallet/session checks. */
  loading: boolean
  /** Connected wallet successfully checked and is not admin (and no SIWS admin session). */
  denied: boolean
  /** SIWS cookie session is an Owl Vision admin (works even if adapter disconnected). */
  adminSessionActive: boolean
}

/**
 * OwlSwap access gate aligned with Header / OwlSend:
 * - SIWS `?session=1` keeps admin preview after disconnect/reconnect
 * - wallet `?wallet=` check with cache
 * - transient API errors never hard-deny
 */
export function useOwlSwapAdminAccess(params: {
  initialViewerIsAdmin: boolean
  isPublic: boolean
}): AccessState {
  const { initialViewerIsAdmin, isPublic } = params
  const { publicKey, connected } = useWallet()
  const visibilityTick = useVisibilityTick()
  const wallet = publicKey?.toBase58() ?? ''

  const [adminSessionActive, setAdminSessionActive] = useState(initialViewerIsAdmin)
  const [walletIsAdmin, setWalletIsAdmin] = useState<boolean | null>(() => {
    if (typeof window !== 'undefined' && wallet) {
      const cached = getCachedAdmin(wallet)
      if (cached !== null) return cached
    }
    return initialViewerIsAdmin ? true : null
  })
  const [walletCheckPending, setWalletCheckPending] = useState(() => {
    if (isPublic) return false
    if (!connected || !wallet) return false
    return getCachedAdmin(wallet) === null && !initialViewerIsAdmin
  })

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
  }, [isPublic, visibilityTick])

  useEffect(() => {
    if (isPublic) {
      setWalletCheckPending(false)
      return
    }
    if (!connected || !publicKey) {
      setWalletIsAdmin(null)
      setWalletCheckPending(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setWalletIsAdmin(cached)
      setWalletCheckPending(false)
    } else {
      setWalletCheckPending(true)
    }

    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`, { cache: 'no-store' })
      .then((res) => {
        if (cancelled) return undefined
        return res.ok ? res.json() : undefined
      })
      .then((data) => {
        if (cancelled || data === undefined) return
        const admin = data?.isAdmin === true
        const role = admin ? parseAdminRole(data?.role) : null
        setCachedAdmin(addr, admin, role)
        setWalletIsAdmin(admin)
      })
      .catch(() => {
        /* do not clear admin on network errors */
      })
      .finally(() => {
        if (!cancelled) setWalletCheckPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isPublic, visibilityTick])

  const isAdmin =
    walletIsAdmin === true || adminSessionActive === true || initialViewerIsAdmin === true
  const allowed = isPublic || isAdmin
  const denied =
    !isPublic &&
    connected &&
    Boolean(publicKey) &&
    !walletCheckPending &&
    walletIsAdmin === false &&
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
    loading,
    denied,
    adminSessionActive,
  }
}
