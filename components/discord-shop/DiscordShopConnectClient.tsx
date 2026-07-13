'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import { Button } from '@/components/ui/button'
import { useSiwsSession } from '@/hooks/use-siws-session'
import { useWallet } from '@solana/wallet-adapter-react'
import { cn } from '@/lib/utils'

type Props = {
  state: string
  className?: string
}

export function DiscordShopConnectClient({ state, className }: Props) {
  const { connected } = useWallet()
  const { sessionWallet, signedIn, checking, checkSession } = useSiwsSession()
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linked, setLinked] = useState(false)

  const linkDiscord = useCallback(async () => {
    setLinking(true)
    setLinkError(null)
    try {
      const res = await fetch('/api/discord-shop/connect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean }
      if (!res.ok) {
        setLinkError(j.error ?? 'Could not link wallet')
        return
      }
      setLinked(true)
    } catch {
      setLinkError('Network error — try again')
    } finally {
      setLinking(false)
    }
  }, [state])

  useEffect(() => {
    if (signedIn && connected && !linked && !linking) {
      void linkDiscord()
    }
  }, [signedIn, connected, linked, linking, linkDiscord])

  if (!state) {
    return (
      <div className={cn('rounded-xl border border-red-400/40 bg-red-950/30 p-6 text-red-100', className)}>
        <p className="font-semibold">Invalid link</p>
        <p className="mt-2 text-sm text-red-100/90">
          Run <code className="rounded bg-black/30 px-1">/owltopia-shop wallet</code> in Discord to get a fresh
          connect link.
        </p>
      </div>
    )
  }

  if (linked) {
    return (
      <div
        className={cn(
          'rounded-xl border border-emerald-400/40 bg-emerald-950/30 p-6 text-emerald-50',
          className
        )}
      >
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          Wallet linked for Discord shop
        </div>
        <p className="mt-2 text-sm text-emerald-50/90">
          You can close this page and return to Discord. Purchases will auto-deliver to your connected wallet.
        </p>
        {sessionWallet ? (
          <p className="mt-3 font-mono text-xs text-emerald-100/80">{sessionWallet}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="rounded-xl border border-white/10 bg-[#10161C] p-6">
        <h1 className="text-xl font-semibold text-white">Link wallet for Owltopia Shop</h1>
        <p className="mt-2 text-sm text-white/75">
          Connect your Solana wallet and sign in so the Discord bot can send OWL automatically after you buy from
          the marketplace.
        </p>
        <div className="mt-4">
          <WalletConnectButton />
        </div>
      </div>

      {checking ? (
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking session…
        </div>
      ) : connected && !signedIn ? (
        <Gen2PresaleSignInPrompt
          message="Sign a one-time message with your wallet to prove ownership."
          onSignedIn={() => void checkSession()}
        />
      ) : connected && signedIn ? (
        <div className="rounded-xl border border-white/10 bg-[#10161C] p-4">
          <p className="text-sm text-white/80">
            Signed in as <span className="font-mono text-xs">{sessionWallet}</span>
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={linking}
            onClick={() => void linkDiscord()}
          >
            {linking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Link to Discord
          </Button>
        </div>
      ) : null}

      {linkError ? <p className="text-sm text-red-300">{linkError}</p> : null}
    </div>
  )
}
