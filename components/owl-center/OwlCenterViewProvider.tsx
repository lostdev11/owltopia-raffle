'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import {
  isOwlCenterAdminOnlyPath,
  OWL_CENTER_HOLDER_HOME,
  readStoredOwlCenterViewMode,
  writeStoredOwlCenterViewMode,
  type OwlCenterViewMode,
} from '@/lib/owl-center/view-mode'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'

type OwlCenterViewContextValue = {
  /** Admin check still in flight. */
  adminLoading: boolean
  /** Connected wallet or SIWS session is an Owl Vision admin. */
  isOwlCenterAdmin: boolean
  /** Public (default) vs admin launchpad tools. Non-admins are always public. */
  viewMode: OwlCenterViewMode
  /** Admin + admin view — show generator, submit, etc. */
  showAdminFeatures: boolean
  setViewMode: (mode: OwlCenterViewMode) => void
}

const OwlCenterViewContext = createContext<OwlCenterViewContextValue | null>(null)

export function OwlCenterViewProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { publicKey, connected } = useWallet()
  const visibilityTick = useVisibilityTick()
  const wallet = publicKey?.toBase58() ?? ''

  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [adminSessionActive, setAdminSessionActive] = useState<boolean | null>(null)
  const [viewMode, setViewModeState] = useState<OwlCenterViewMode>('public')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    setViewModeState(readStoredOwlCenterViewMode())
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/check?session=1', { credentials: 'include', cache: 'no-store' })
      .then((res) => (cancelled || !res.ok ? undefined : res.json()))
      .then((data) => {
        if (cancelled || data === undefined) return
        setAdminSessionActive(data?.isAdmin === true)
      })
      .catch(() => {
        /* keep prior hint */
      })
    return () => {
      cancelled = true
    }
  }, [visibilityTick])

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) setIsAdmin(cached)

    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`, { cache: 'no-store' })
      .then((res) => (cancelled || !res.ok ? undefined : res.json()))
      .then((data) => {
        if (cancelled || data === undefined) return
        const admin = data?.isAdmin === true
        setCachedAdmin(addr, admin, data?.role)
        setIsAdmin(admin)
      })
      .catch(() => {
        /* keep cache on transient errors */
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, visibilityTick])

  const isOwlCenterAdmin = isAdmin === true || adminSessionActive === true
  const adminLoading =
    !hydrated || (connected && isAdmin === null) || adminSessionActive === null

  const effectiveViewMode: OwlCenterViewMode =
    isOwlCenterAdmin && viewMode === 'admin' ? 'admin' : 'public'
  const showAdminFeatures = isOwlCenterAdmin && effectiveViewMode === 'admin'

  const setViewMode = useCallback(
    (mode: OwlCenterViewMode) => {
      if (!isOwlCenterAdmin) return
      const next = mode === 'admin' ? 'admin' : 'public'
      setViewModeState(next)
      writeStoredOwlCenterViewMode(next)
      if (next === 'public' && isOwlCenterAdminOnlyPath(pathname)) {
        router.push(OWL_CENTER_HOLDER_HOME)
      }
    },
    [isOwlCenterAdmin, pathname, router]
  )

  // Non-admin on admin-only route → holder mint console
  useEffect(() => {
    if (adminLoading || isOwlCenterAdmin) return
    if (isOwlCenterAdminOnlyPath(pathname)) {
      router.replace(OWL_CENTER_HOLDER_HOME)
    }
  }, [adminLoading, isOwlCenterAdmin, pathname, router])

  const value = useMemo<OwlCenterViewContextValue>(
    () => ({
      adminLoading,
      isOwlCenterAdmin,
      viewMode: effectiveViewMode,
      showAdminFeatures,
      setViewMode,
    }),
    [adminLoading, isOwlCenterAdmin, effectiveViewMode, showAdminFeatures, setViewMode]
  )

  return <OwlCenterViewContext.Provider value={value}>{children}</OwlCenterViewContext.Provider>
}

export function useOwlCenterView(): OwlCenterViewContextValue {
  const ctx = useContext(OwlCenterViewContext)
  if (!ctx) {
    throw new Error('useOwlCenterView must be used within OwlCenterViewProvider')
  }
  return ctx
}
