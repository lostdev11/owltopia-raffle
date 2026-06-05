'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Gift, Loader2 } from 'lucide-react'

type PendingReward = {
  id: string
  reward_recipient_role: 'buyer' | 'referrer'
  referral_code: string
  issued_at: string
}

type EligibleRaffle = {
  id: string
  slug: string
  title: string
}

type Props = {
  pendingRewards: PendingReward[]
  eligibleRaffles: EligibleRaffle[]
  walletAddress: string
  onRedeemed?: () => void
}

export function ReferralRewardsRedeem({
  pendingRewards,
  eligibleRaffles,
  walletAddress,
  onRedeemed,
}: Props) {
  const [redeemingId, setRedeemingId] = useState<string | null>(null)
  const [selectedRaffleByReward, setSelectedRaffleByReward] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (eligibleRaffles.length === 1 && pendingRewards.length > 0) {
      const only = eligibleRaffles[0]!.id
      setSelectedRaffleByReward((prev) => {
        const next = { ...prev }
        for (const r of pendingRewards) {
          if (!next[r.id]) next[r.id] = only
        }
        return next
      })
    }
  }, [eligibleRaffles, pendingRewards])

  const redeem = useCallback(
    async (rewardId: string) => {
      const raffleId = selectedRaffleByReward[rewardId]
      if (!raffleId) {
        setError('Choose a raffle first.')
        return
      }
      setRedeemingId(rewardId)
      setError(null)
      try {
        const createRes = await fetch('/api/referrals/redeem-free-entry', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rewardId, raffleId }),
        })
        const createJson = (await createRes.json()) as {
          success?: boolean
          entryId?: string
          complimentaryToken?: string
          error?: string
        }
        if (!createRes.ok || !createJson.success || !createJson.entryId || !createJson.complimentaryToken) {
          throw new Error(createJson.error || 'Could not start redemption')
        }

        const wallet = walletAddress.trim()
        const confirmRes = await fetch('/api/entries/confirm-complimentary', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entryId: createJson.entryId,
            token: createJson.complimentaryToken,
            walletAddress: wallet,
          }),
        })
        if (!confirmRes.ok) {
          throw new Error('Could not confirm free entry')
        }
        onRedeemed?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Redemption failed')
      } finally {
        setRedeemingId(null)
      }
    },
    [onRedeemed, selectedRaffleByReward, walletAddress]
  )

  if (pendingRewards.length === 0) return null

  return (
    <Card className="rounded-xl border-primary/30 bg-primary/[0.04] shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4" aria-hidden />
          Free entries to redeem
        </CardTitle>
        <CardDescription>Use on any live SOL or USDC raffle.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingRewards.map((reward) => (
          <div key={reward.id} className="space-y-2 rounded-lg border border-border/50 p-3">
            <p className="text-sm font-medium">
              {reward.reward_recipient_role === 'buyer'
                ? 'Unlocked from your first referral purchase'
                : `Referral reward · code ${reward.referral_code}`}
            </p>
            {eligibleRaffles.length > 0 ? (
              <select
                className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
                value={selectedRaffleByReward[reward.id] ?? ''}
                onChange={(e) =>
                  setSelectedRaffleByReward((prev) => ({ ...prev, [reward.id]: e.target.value }))
                }
              >
                <option value="">Choose raffle…</option>
                {eligibleRaffles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">
                No eligible live raffles right now.{' '}
                <Link href="/raffles" className="text-primary underline">
                  Browse raffles
                </Link>
              </p>
            )}
            <Button
              type="button"
              className="min-h-[44px] w-full touch-manipulation"
              disabled={redeemingId === reward.id || eligibleRaffles.length === 0}
              onClick={() => void redeem(reward.id)}
            >
              {redeemingId === reward.id ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redeeming…
                </>
              ) : (
                'Redeem free entry'
              )}
            </Button>
          </div>
        ))}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
