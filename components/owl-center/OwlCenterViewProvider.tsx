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
  OWL_CENTER_VIEW_MODE_STORAGE_KEY,
  readStoredOwlCenterViewModeOrNull,
  writeStoredOwlCenterViewMode,
  type OwlCenterViewMode,
} from '@/lib/owl-center/view-mode'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'

type OwlCenterViewContextValue = {
  /** Admin check still in flight. */
  adminLoading: boolean
  /** Connected wallet or SIWS session is an Owl Vision admin. */
  isOwlCenterAdmin: boolean
  /** Connected wallet or SIWS session is an approved launchpad partner (non-admin). */
  isLaunchpadPartner: boolean
  /** Public (default) vs admin launchpad tools. Non-admins are always public. */
  viewMode: OwlCenterViewMode
  /** Admin + admin view — show generator, submit, etc. */
  showAdminFeatures: boolean
  /** Generator + launch submit visible — admins in admin view, or approved partners. */
  showLaunchTools: boolean
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
  const [partnerAccess, setPartnerAccess] = useState<boolean | null>(null)
  const [viewMode, setViewModeState] = useState<OwlCenterViewMode>('public')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    const stored = readStoredOwlCenterViewModeOrNull()
    if (stored !== null) setViewModeState(stored)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== OWL_CENTER_VIEW_MODE_STORAGE_KEY) return
      const next = event.newValue === 'admin' ? 'admin' : event.newValue === 'public' ? 'public' : null
      if (next) setViewModeState(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
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

  // Launchpad partner check — session first, connected wallet as a UI hint.
  useEffect(() => {
    let cancelled = false
    const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''
    fetch(`/api/owl-center/launch-access${qs}`, { credentials: 'include', cache: 'no-store' })
      .then((res) => (cancelled || !res.ok ? undefined : res.json()))
      .then((data) => {
        if (cancelled || data === undefined) return
        setPartnerAccess(data?.isPartner === true)
      })
      .catch(() => {
        if (!cancelled) setPartnerAccess((prev) => prev ?? false)
      })
    return () => {
      cancelled = true
    }
  }, [wallet, visibilityTick])

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
  const isLaunchpadPartner = !isOwlCenterAdmin && partnerAccess === true
  const adminLoading =
    !hydrated ||
    (connected && isAdmin === null) ||
    adminSessionActive === null ||
    partnerAccess === null

  // Verified admins default to admin view until they explicitly choose public preview.
  useEffect(() => {
    if (!hydrated || adminLoading || !isOwlCenterAdmin) return
    if (readStoredOwlCenterViewModeOrNull() !== null) return
    setViewModeState('admin')
    writeStoredOwlCenterViewMode('admin')
  }, [hydrated, adminLoading, isOwlCenterAdmin])

  const effectiveViewMode: OwlCenterViewMode =
    isOwlCenterAdmin && viewMode === 'admin' ? 'admin' : 'public'
  const showAdminFeatures = isOwlCenterAdmin && effectiveViewMode === 'admin'
  const showLaunchTools = showAdminFeatures || isLaunchpadPartner

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

  // No launch-tools access on generator/launch routes → holder mint console
  useEffect(() => {
    if (adminLoading || isOwlCenterAdmin || isLaunchpadPartner) return
    if (isOwlCenterAdminOnlyPath(pathname)) {
      router.replace(OWL_CENTER_HOLDER_HOME)
    }
  }, [adminLoading, isOwlCenterAdmin, isLaunchpadPartner, pathname, router])

  const value = useMemo<OwlCenterViewContextValue>(
    () => ({
      adminLoading,
      isOwlCenterAdmin,
      isLaunchpadPartner,
      viewMode: effectiveViewMode,
      showAdminFeatures,
      showLaunchTools,
      setViewMode,
    }),
    [
      adminLoading,
      isOwlCenterAdmin,
      isLaunchpadPartner,
      effectiveViewMode,
      showAdminFeatures,
      showLaunchTools,
      setViewMode,
    ]
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
