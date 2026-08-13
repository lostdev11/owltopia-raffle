'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import { RaffleListThumbnail } from '@/components/RaffleListThumbnail'
import { useSiwsSession } from '@/hooks/use-siws-session'
import type { EntryWithRaffle } from '@/lib/db/entries'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { format } from 'date-fns'
import { ExternalLink, Ticket, Calendar } from 'lucide-react'
import {
  PURCHASE_COMPLETED_EVENT,
  type PurchaseCompletedDetail,
} from '@/lib/cart/purchase-complete-events'

const SOLANA_EXPLORER_TX = 'https://explorer.solana.com/tx'

interface MyEntriesListProps {
  walletAddress: string
}

export function MyEntriesList({ walletAddress }: MyEntriesListProps) {
  const { sessionWallet, signedIn, checking, checkSession } = useSiwsSession()
  const [items, setItems] = useState<EntryWithRaffle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sessionMatchesWallet =
    typeof sessionWallet === 'string' && walletsEqualSolana(sessionWallet, walletAddress)

  const load = useCallback(() => {
    if (!walletAddress || !sessionMatchesWallet) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fetch('/api/entries/my', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (res) => {
        if (res.ok) return res.json()
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (res.status === 401) {
          throw new Error(body.error || 'Sign in required to view your entries')
        }
        if (res.status === 400) {
          throw new Error(body.error || 'Wallet required')
        }
        throw new Error(body.error || 'Failed to load entries')
      })
      .then((data: EntryWithRaffle[]) => {
        setItems(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load your entries')
        setItems([])
      })
      .finally(() => setLoading(false))
  }, [walletAddress, sessionMatchesWallet])

  useEffect(() => {
    if (checking) return
    if (!signedIn || !sessionMatchesWallet) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }
    load()
  }, [checking, signedIn, sessionMatchesWallet, load])

  useEffect(() => {
    const onPurchase = (e: Event) => {
      const d = (e as CustomEvent<PurchaseCompletedDetail>).detail
      if (!d?.wallet || d.wallet !== walletAddress) return
      if (!sessionMatchesWallet) return
      load()
    }
    window.addEventListener(PURCHASE_COMPLETED_EVENT, onPurchase)
    return () => window.removeEventListener(PURCHASE_COMPLETED_EVENT, onPurchase)
  }, [walletAddress, sessionMatchesWallet, load])

  if (checking) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Checking sign-in…
      </div>
    )
  }

  if (!signedIn) {
    return (
      <Gen2PresaleSignInPrompt
        title="Sign in to see raffles you entered"
        message="Connecting a wallet is not enough — sign a one-time message (no fee) so we can load only your entries."
        onSignedIn={() => {
          void checkSession()
        }}
      />
    )
  }

  if (!sessionMatchesWallet) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-6 text-muted-foreground space-y-3">
        <p className="text-foreground font-medium">Signed in with a different wallet</p>
        <p className="text-sm">
          Your site session does not match the wallet currently connected. Sign in again with this
          wallet to view its raffle entries.
        </p>
        <Gen2PresaleSignInPrompt
          title="Sign in with the connected wallet"
          message="This replaces the previous session with a signature from the wallet shown in the header."
          onSignedIn={() => {
            void checkSession()
          }}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Loading your entries…
      </div>
    )
  }

  if (error) {
    const needsSignIn = /sign in/i.test(error)
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
        {needsSignIn ? (
          <Gen2PresaleSignInPrompt
            title="Sign in again"
            message="Your session expired or was reset. Sign a one-time message to reload your entries."
            onSignedIn={() => {
              void checkSession()
            }}
          />
        ) : null}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-8 text-center text-muted-foreground">
        <p className="text-lg">You haven’t entered any raffles yet.</p>
        <p className="mt-2 text-sm">Purchase tickets on a raffle to see them here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {items.map(({ entry, raffle }) => (
        <Card key={entry.id} className="overflow-hidden border-green-500/20 bg-card/80">
          <CardHeader className="pb-2">
            <div className="flex items-start gap-3">
              <Link
                href={`/raffles/${raffle.slug}`}
                className="shrink-0"
                aria-label={`View ${raffle.title}`}
              >
                <RaffleListThumbnail
                  raffle={{
                    id: raffle.id,
                    image_url: raffle.image_url ?? null,
                    image_fallback_url: raffle.image_fallback_url ?? null,
                    prize_type: raffle.prize_type === 'nft' ? 'nft' : 'crypto',
                    prize_currency: raffle.prize_currency ?? null,
                  }}
                  size="md"
                  className="rounded-md"
                  fallbackLabel="NFT"
                  loading="lazy"
                />
              </Link>
              <div className="min-w-0 flex-1 flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/raffles/${raffle.slug}`}
                  className="font-semibold text-primary hover:underline break-words"
                >
                  {raffle.title}
                </Link>
                <Badge
                  variant={
                    entry.status === 'confirmed'
                      ? 'default'
                      : entry.status === 'rejected'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {entry.status}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {format(new Date(entry.created_at), 'MMM d, yyyy · h:mm a')}
              </span>
              <span className="flex items-center gap-1.5">
                <Ticket className="h-4 w-4" />
                {entry.ticket_quantity} ticket{entry.ticket_quantity !== 1 ? 's' : ''}
              </span>
              <span>
                {entry.amount_paid} {entry.currency}
              </span>
            </div>
            {entry.transaction_signature && (
              <a
                href={`${SOLANA_EXPLORER_TX}/${entry.transaction_signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                View on blockchain
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
