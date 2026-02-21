'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Settings, Plus } from 'lucide-react'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin, type AdminRole } from '@/lib/admin-check-cache'

export function Header() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [adminRole, setAdminRole] = useState<AdminRole | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  )

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
  }, [connected, publicKey])

  // Full admins see Owl Vision; raffle_creator only sees Create Raffle. Null role (e.g. stale cache) treated as full.
  const showOwlVision = isAdmin && (adminRole === 'full' || adminRole === null)
  const showCreateRaffle = isAdmin && adminRole === 'raffle_creator'

  return (
    <header className="w-full bg-black border-b border-green-500/20">
      <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <Link href="/" className="flex-1 min-w-0">
            <Logo className="flex-1 max-w-full h-auto" width={600} height={150} priority />
          </Link>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {showOwlVision && (
              <Link href="/admin">
                <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                  <Settings className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Owl Vision</span>
                  <span className="sm:hidden">Owl Vision</span>
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
            <WalletConnectButton />
          </div>
        </div>
      </div>
    </header>
  )
}
