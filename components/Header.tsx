'use client'

import { useState, useEffect, useMemo } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Menu } from 'lucide-react'
import { HeaderRafflesMenuDesktop, HeaderRafflesMenuMobile } from '@/components/HeaderRafflesMenu'
import { HeaderNavGroupMenuDesktop, HeaderNavGroupMenuMobile } from '@/components/HeaderNavGroupMenu'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import {
  ADMIN_NAV_GROUP,
  COMMUNITY_NAV_GROUP,
  CREATE_RAFFLE_NAV_ITEM,
  DASHBOARD_NAV_ITEM,
  OWLS_NAV_GROUP,
  filterAdminNavItems,
  type SiteNavGroup,
} from '@/lib/site-nav'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function Header() {
  const { publicKey, connected } = useWallet()
  const pathname = usePathname()
  const wallet = publicKey?.toBase58() ?? ''
  const visibilityTick = useVisibilityTick()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [adminRole, setAdminRole] = useState<AdminRole | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  )
  /** SIWS session wallet is admin — shows Owl Vision even if the wallet adapter is disconnected (common on mobile). */
  const [adminSessionActive, setAdminSessionActive] = useState<boolean | null>(null)

  useEffect(() => {
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
  }, [visibilityTick])

  // Re-run when connected/publicKey change or when user returns to tab so Owl Vision link appears right away.
  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setAdminRole(null)
      return
    }
    const addr = publicKey.toBase58()
    const cachedAdmin = getCachedAdmin(addr)
    const cachedRole = getCachedAdminRole(addr)
    if (cachedAdmin !== null) {
      setIsAdmin(cachedAdmin)
      setAdminRole(cachedRole)
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
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
        setAdminRole(role)
      })
      .catch(() => {
        /* do not clear admin on network errors — keeps cache / SIWS session UX stable */
      })
    return () => { cancelled = true }
  }, [connected, publicKey, visibilityTick])

  // Full admins see Owl Vision (connected wallet in admins table, or SIWS session from /admin).
  const showOwlVision = isAdmin === true || adminSessionActive === true

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const desktopNavButtonClass =
    'text-white/90 hover:text-white hover:bg-white/10 active:bg-white/15 text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10'

  const adminNavGroup = useMemo<SiteNavGroup>(
    () => ({
      ...ADMIN_NAV_GROUP,
      items: filterAdminNavItems({ showOwlVision }),
    }),
    [showOwlVision]
  )

  const mobileNavGroups = useMemo(
    () =>
      [COMMUNITY_NAV_GROUP, OWLS_NAV_GROUP, ...(adminNavGroup.items.length > 0 ? [adminNavGroup] : [])],
    [adminNavGroup]
  )

  const dashboardActive =
    pathname === DASHBOARD_NAV_ITEM.href || pathname.startsWith(`${DASHBOARD_NAV_ITEM.href}/`)
  const DashboardIcon = DASHBOARD_NAV_ITEM.icon

  const createRaffleActive =
    pathname === CREATE_RAFFLE_NAV_ITEM.href || pathname.startsWith(`${CREATE_RAFFLE_NAV_ITEM.href}/`)
  const CreateRaffleIcon = CREATE_RAFFLE_NAV_ITEM.icon

  return (
    <header className="w-full bg-black border-b border-green-500/20 text-white">
      <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4 header-safe-area-inner">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <Link
            href="/"
            className="min-w-0 flex-1 max-w-[min(100%,calc(100%-11rem))] overflow-hidden md:max-w-[min(100%,calc(100%-22rem))] lg:max-w-[min(100%,calc(100%-30rem))]"
          >
            <Logo className="max-w-full h-auto" width={600} height={150} priority />
          </Link>
          {/* Single right cluster: desktop nav + one wallet button (avoid duplicate WalletMultiButton). Mobile: menu + wallet. */}
          <div className="flex items-center gap-2 lg:gap-4 flex-shrink-0">
            <div className="hidden md:flex items-center gap-2 lg:gap-4">
              <HeaderRafflesMenuDesktop buttonClassName={desktopNavButtonClass} />
              <HeaderNavGroupMenuDesktop group={COMMUNITY_NAV_GROUP} buttonClassName={desktopNavButtonClass} />
              <HeaderNavGroupMenuDesktop group={OWLS_NAV_GROUP} buttonClassName={desktopNavButtonClass} />
              {connected && (
                <Link href={DASHBOARD_NAV_ITEM.href}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(desktopNavButtonClass, dashboardActive && 'bg-white/10 text-white')}
                  >
                    <DashboardIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">{DASHBOARD_NAV_ITEM.label}</span>
                  </Button>
                </Link>
              )}
              {connected && (
                <Link href={CREATE_RAFFLE_NAV_ITEM.href}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(desktopNavButtonClass, createRaffleActive && 'bg-white/10 text-white')}
                  >
                    <CreateRaffleIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">{CREATE_RAFFLE_NAV_ITEM.label}</span>
                  </Button>
                </Link>
              )}
              {adminNavGroup.items.length > 0 && (
                <HeaderNavGroupMenuDesktop group={adminNavGroup} buttonClassName={desktopNavButtonClass} />
              )}
            </div>
            <div className="flex md:hidden">
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 min-h-[44px] min-w-[44px] touch-manipulation text-white/90 hover:text-white hover:bg-white/10 active:bg-white/15"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu — raffles, partners, and more"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </div>
            <div className="shrink-0">
              <ThemeToggle />
            </div>
            <div className="shrink-0">
              <WalletConnectButton />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile nav sheet */}
      <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <DialogContent className="max-w-[min(90vw,320px)] rounded-xl p-0 gap-0 border-green-500/20 data-[state=open]:slide-in-from-top-4">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-left text-base">Menu</DialogTitle>
          </DialogHeader>
          <nav className="flex flex-col p-2 pb-6 max-h-[min(85vh,32rem)] overflow-y-auto overscroll-contain">
            <HeaderRafflesMenuMobile onNavigate={() => setMobileMenuOpen(false)} />
            {mobileNavGroups.map((group, index) => (
              <HeaderNavGroupMenuMobile
                key={group.id}
                group={group}
                onNavigate={() => setMobileMenuOpen(false)}
                showBorder={index < mobileNavGroups.length - 1 || connected}
              />
            ))}
            {connected && (
              <div className="pt-1">
                <p className="px-4 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Account
                </p>
                <Link
                  href={DASHBOARD_NAV_ITEM.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex gap-3 px-4 py-3 rounded-lg min-h-[48px] touch-manipulation hover:bg-white/10 active:bg-white/15',
                    dashboardActive && 'bg-white/10'
                  )}
                >
                  <DashboardIcon className="h-5 w-5 shrink-0 text-sky-400/90" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{DASHBOARD_NAV_ITEM.label}</span>
                    {DASHBOARD_NAV_ITEM.description ? (
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {DASHBOARD_NAV_ITEM.description}
                      </span>
                    ) : null}
                  </span>
                </Link>
                <Link
                  href={CREATE_RAFFLE_NAV_ITEM.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex gap-3 px-4 py-3 rounded-lg min-h-[48px] touch-manipulation hover:bg-white/10 active:bg-white/15',
                    createRaffleActive && 'bg-white/10'
                  )}
                >
                  <CreateRaffleIcon className="h-5 w-5 shrink-0 text-amber-400/90" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{CREATE_RAFFLE_NAV_ITEM.label}</span>
                    {CREATE_RAFFLE_NAV_ITEM.description ? (
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {CREATE_RAFFLE_NAV_ITEM.description}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </div>
            )}
            {!connected && (
              <p className="px-4 pt-2 pb-1 text-xs text-muted-foreground">
                Connect your wallet to open your dashboard and host tools.
              </p>
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </header>
  )
}
