'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Loader2, Lock } from 'lucide-react'

type AccessState =
  | { status: 'loading' }
  | { status: 'need_wallet' }
  | { status: 'need_sign_in' }
  | { status: 'denied' }
  | { status: 'allowed'; isAdmin: boolean }

export function AuctionsAccessGate({ children }: { children: React.ReactNode }) {
  const { publicKey, connected } = useWallet()
  const { signIn, signingIn } = useSiwsSignIn()
  const [access, setAccess] = useState<AccessState>({ status: 'loading' })

  const check = useCallback(async () => {
    if (!connected || !publicKey) {
      setAccess({ status: 'need_wallet' })
      return
    }
    setAccess({ status: 'loading' })
    try {
      const res = await fetch('/api/auctions/access', { credentials: 'include', cache: 'no-store' })
      if (res.status === 401) {
        setAccess({ status: 'need_sign_in' })
        return
      }
      const json = (await res.json().catch(() => ({}))) as {
        allowed?: boolean
        isAdmin?: boolean
      }
      if (!res.ok || !json.allowed) {
        setAccess({ status: 'denied' })
        return
      }
      setAccess({ status: 'allowed', isAdmin: !!json.isAdmin })
    } catch {
      setAccess({ status: 'denied' })
    }
  }, [connected, publicKey])

  useEffect(() => {
    void check()
  }, [check])

  if (access.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Checking partner access…
      </div>
    )
  }

  if (access.status === 'need_wallet') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center space-y-4">
        <Lock className="mx-auto h-8 w-8 text-emerald-500" />
        <h1 className="text-2xl font-semibold">Partner auctions</h1>
        <p className="text-muted-foreground text-sm">
          Auctions are limited to verified partners and site admins during beta. Connect your partner
          wallet to continue.
        </p>
        <WalletConnectButton />
      </div>
    )
  }

  if (access.status === 'need_sign_in') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center space-y-4">
        <Lock className="mx-auto h-8 w-8 text-emerald-500" />
        <h1 className="text-2xl font-semibold">Sign in required</h1>
        <p className="text-muted-foreground text-sm">
          Sign in with your connected wallet so we can verify partner access.
        </p>
        <Button
          disabled={signingIn}
          onClick={() => void signIn().then(() => check())}
          className="min-h-[44px]"
        >
          {signingIn ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Sign in
        </Button>
      </div>
    )
  }

  if (access.status === 'denied') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center space-y-4">
        <Lock className="mx-auto h-8 w-8 text-amber-500" />
        <h1 className="text-2xl font-semibold">Partners only</h1>
        <p className="text-muted-foreground text-sm">
          This auction beta is open to verified partner community creators and Owltopia admins. Apply
          to the partner program if you want to host.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="default" className="min-h-[44px]">
            <Link href="/partner-program">Partner program</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link href="/raffles">Browse raffles</Link>
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
