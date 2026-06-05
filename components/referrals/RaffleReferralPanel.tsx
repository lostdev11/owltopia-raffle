'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Trophy } from 'lucide-react'
import type { RaffleReferralPromoterRow } from '@/lib/referrals/types'

type Props = {
  promoters: RaffleReferralPromoterRow[]
}

function formatVolume(volume: Record<string, number>): string {
  const parts = Object.entries(volume)
    .filter(([, v]) => v > 0)
    .map(([cur, v]) => {
      if (cur === 'USDC') return `${v.toFixed(2)} USDC`
      return `${v.toFixed(4)} ${cur}`
    })
  return parts.length ? parts.join(' · ') : '—'
}

/** Public referral leaderboard for a raffle (share card lives in page header). */
export function RaffleReferralPanel({ promoters }: Props) {
  if (promoters.length === 0) return null

  return (
    <Card className="rounded-xl border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4" aria-hidden />
          Referral leaderboard
        </CardTitle>
        <CardDescription>Confirmed tickets sold via referral links.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-2 font-medium">#</th>
              <th className="pb-2 pr-2 font-medium">Promoter</th>
              <th className="pb-2 pr-2 font-medium tabular-nums">Tickets</th>
              <th className="pb-2 font-medium">Volume</th>
            </tr>
          </thead>
          <tbody>
            {promoters.slice(0, 10).map((p) => (
              <tr key={`${p.rank}-${p.referralCode}`} className="border-b border-border/40 last:border-0">
                <td className="py-2.5 pr-2 tabular-nums text-muted-foreground">{p.rank}</td>
                <td className="py-2.5 pr-2 font-medium">{p.displayName || p.referralCode}</td>
                <td className="py-2.5 pr-2 tabular-nums">{p.ticketsReferred}</td>
                <td className="py-2.5 text-xs text-muted-foreground">{formatVolume(p.referredVolume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
