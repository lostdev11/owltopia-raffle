'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Settings, Plus, LayoutDashboard, Trophy, Menu, Gift, Landmark, Bird } from 'lucide-react'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'

export function Header() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const visibilityTick = useVisibilityTick()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [adminRole, setAdminRole] = useState<AdminRole | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  )

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
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
        setAdminRole(role)
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false)
          setAdminRole(null)
        }
      })
    return () => { cancelled = true }
  }, [connected, publicKey, visibilityTick])

  // Full admins see Owl Vision. Anyone with a connected wallet can create a raffle.
  const showOwlVision = Boolean(isAdmin)
  /** Nesting is admin-only in nav until the public flow is ready — avoids a dead link for visitors. */
  const showNestingNav = Boolean(isAdmin)
  const showCreateRaffle = connected

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navLinks = [
    { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
    { href: '/council', label: 'Council', icon: Landmark },
    ...(showNestingNav ? [{ href: '/nesting', label: 'Nesting', icon: Bird }] : []),
    ...(connected ? [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] : []),
    ...(showOwlVision ? [{ href: '/admin', label: 'Owl Vision', icon: Settings }] : []),
    ...(showOwlVision ? [{ href: '/admin/community-giveaways', label: 'Giveaways', icon: Gift }] : []),
    ...(showCreateRaffle ? [{ href: '/admin/raffles/new', label: 'Create Raffle', icon: Plus }] : []),
  ]

  return (
    <header className="w-full bg-black border-b border-green-500/20">
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
              <Link href="/leaderboard">
                <Button variant="ghost" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                  <Trophy className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Leaderboard</span>
                </Button>
              </Link>
              <Link href="/council">
                <Button variant="ghost" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                  <Landmark className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Council</span>
                </Button>
              </Link>
              {showNestingNav && (
                <Link href="/nesting">
                  <Button variant="ghost" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                    <Bird className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Nesting</span>
                  </Button>
                </Link>
              )}
              {connected && (
                <Link href="/dashboard">
                  <Button variant="ghost" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                    <LayoutDashboard className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Dashboard</span>
                  </Button>
                </Link>
              )}
              {showOwlVision && (
                <Link href="/admin">
                  <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                    <Settings className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Owl Vision</span>
                    <span className="sm:hidden">Owl Vision</span>
                  </Button>
                </Link>
              )}
              {showOwlVision && (
                <Link href="/admin/community-giveaways">
                  <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                    <Gift className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Giveaways</span>
                    <span className="sm:hidden">Giveaways</span>
                  </Button>
                </Link>
              )}
              {showCreateRaffle && (
                <Link href="/admin/raffles/new">
                  <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                    <Plus className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Create Raffle</span>
                    <span className="sm:hidden">Create Raffle</span>
                  </Button>
                </Link>
              )}
            </div>
            <div className="flex md:hidden">
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 min-h-[44px] min-w-[44px] touch-manipulation"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
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
          <nav className="flex flex-col p-2 pb-6">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-white/10 active:bg-white/15 min-h-[48px] touch-manipulation"
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {label}
              </Link>
            ))}
            {navLinks.length === 0 && (
              <p className="px-4 py-3 text-muted-foreground text-sm">Connect your wallet for more options.</p>
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </header>
  )
}
