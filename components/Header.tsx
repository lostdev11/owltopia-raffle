'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'

export function Header() {
  const { publicKey, connected } = useWallet()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!connected || !publicKey) {
        setIsAdmin(false)
        return
      }

      try {
        const response = await fetch(`/api/admin/check?wallet=${publicKey.toBase58()}`)
        if (response.ok) {
          const data = await response.json()
          setIsAdmin(data.isAdmin === true)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        console.error('Error checking admin status:', error)
        setIsAdmin(false)
      }
    }

    checkAdminStatus()
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
