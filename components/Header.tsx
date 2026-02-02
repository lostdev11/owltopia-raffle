'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'

export function Header() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setIsAdmin(cached)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        setCachedAdmin(addr, admin)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => { cancelled = true }
  }, [connected, publicKey])

  return (
    <header className="w-full bg-black border-b border-green-500/20">
      <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <Link href="/" className="flex-1 min-w-0">
            <Logo className="flex-1 max-w-full h-auto" width={600} height={150} priority />
          </Link>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {isAdmin && (
              <Link href="/admin">
                <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3 h-9 sm:h-10">
                  <Settings className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Admin Dashboard</span>
                  <span className="sm:hidden">Admin</span>
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
