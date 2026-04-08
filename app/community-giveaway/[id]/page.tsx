'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Gift, LayoutDashboard, Loader2 } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'
import { getRaffleDisplayImageUrl, getRaffleImageFallbackRawUrl } from '@/lib/raffle-display-image-url'

type PublicG = {
  id: string
  title: string
  description: string | null
  access_gate: string
  starts_at: string
  ends_at: string | null
  prize_image_url?: string | null
}

export default function CommunityGiveawayPublicPage() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { connected } = useWallet()
  const [g, setG] = useState<PublicG | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [prizeImageDead, setPrizeImageDead] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/community-giveaways/${id}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Giveaway not found')
        setG(null)
        return
      }
      setG(json.giveaway as PublicG)
    } catch {
      setError('Could not load giveaway')
      setG(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPrizeImageDead(false)
  }, [g?.id])

  const title = g?.title?.trim() || 'Community giveaway'
  const prizeRaw = g?.prize_image_url?.trim() || null
  const prizeDisplay = prizeRaw ? getRaffleDisplayImageUrl(prizeRaw) : null
  const prizeRawFallback = getRaffleImageFallbackRawUrl(prizeDisplay, prizeRaw ?? undefined)

  return (
    <main className="container mx-auto px-4 py-8 max-w-lg pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <Card className="overflow-hidden border-green-500/20">
        {!loading && g && prizeDisplay && !prizeImageDead ? (
          <div className="relative aspect-square w-full max-h-[min(100vw,420px)] bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- NFT artwork via proxy; GIF safe */}
            <img
              src={prizeDisplay}
              alt={`Prize NFT: ${title}`}
              className="h-full w-full object-cover"
              onError={(e) => {
                if (prizeRawFallback && e.currentTarget.src !== prizeRawFallback) {
                  e.currentTarget.src = prizeRawFallback
                  return
                }
                setPrizeImageDead(true)
              }}
            />
          </div>
        ) : null}
        {!loading && g && (!prizeDisplay || prizeImageDead) ? (
          <div className="flex aspect-square max-h-[220px] w-full items-center justify-center bg-muted/70">
            <Gift className="h-20 w-20 text-muted-foreground opacity-40" aria-hidden />
          </div>
        ) : null}
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Gift className="h-6 w-6 shrink-0" />
            {title}
          </CardTitle>
          <CardDescription>
            Connect your wallet to join this pool giveaway or manage entries from your dashboard. Prize NFT is held in
            platform escrow until a winner claims.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Loading…
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && g && (
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>
                Access:{' '}
                <span className="text-foreground font-medium">
                  {g.access_gate === 'holder_only' ? 'Owl NFT holders only' : 'Everyone'}
                </span>
              </li>
              {g.ends_at ? (
                <li>Entry deadline: {new Date(g.ends_at).toLocaleString()}</li>
              ) : null}
              {g.description ? <li className="text-foreground/90 whitespace-pre-wrap">{g.description}</li> : null}
            </ul>
          )}
          <div className="flex flex-col gap-3 pt-2">
            <div className="touch-manipulation min-h-[44px] [&_button]:min-h-[44px] [&_button]:w-full">
              <WalletConnectButton />
            </div>
            {connected && g && (
              <Button asChild variant="secondary" className="touch-manipulation min-h-[44px] w-full">
                <Link href="/dashboard">
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  Open dashboard to join
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" className="touch-manipulation min-h-[44px] w-full">
              <Link href="/raffles?tab=giveaways">Back to Giveaways</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
