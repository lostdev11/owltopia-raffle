'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Gift, Loader2, LayoutDashboard } from 'lucide-react'

type PublicGiveaway = {
  id: string
  title: string | null
  claimed: boolean
  depositVerified: boolean
  readyToClaim: boolean
}

export default function PublicGiveawayPage() {
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { connected } = useWallet()
  const [info, setInfo] = useState<PublicGiveaway | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/nft-giveaways/${id}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Giveaway not found')
        setInfo(null)
        return
      }
      setInfo(json as PublicGiveaway)
    } catch {
      setError('Could not load giveaway')
      setInfo(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const title = info?.title?.trim() || 'NFT giveaway'

  return (
    <main className="container mx-auto px-4 py-8 max-w-lg">
      <Card className="border-green-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Gift className="h-6 w-6 shrink-0" />
            {title}
          </CardTitle>
          <CardDescription>
            Connect the wallet the team assigned to this giveaway, then open your dashboard and sign in to claim. No
            gas is required from you for the transfer (the platform sends the NFT from escrow).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && info && (
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>
                Status:{' '}
                <span className="text-foreground font-medium">
                  {info.claimed ? 'Claimed' : info.readyToClaim ? 'Ready to claim' : 'Not ready yet'}
                </span>
              </li>
              {!info.depositVerified && !info.claimed && (
                <li>The team still needs to confirm the NFT is in escrow.</li>
              )}
            </ul>
          )}
          <div className="flex flex-col gap-3 pt-2">
            <div className="touch-manipulation min-h-[44px] [&_button]:min-h-[44px] [&_button]:w-full">
              <WalletConnectButton />
            </div>
            {connected && (
              <Button asChild variant="secondary" className="touch-manipulation min-h-[44px] w-full">
                <Link href="/dashboard">
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  Open dashboard to claim
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" className="touch-manipulation min-h-[44px] w-full">
              <Link href="/">Back to home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
