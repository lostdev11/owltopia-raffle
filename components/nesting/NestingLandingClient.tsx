'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Bird, Coins, Layers, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { NestingHero } from '@/components/nesting/NestingHero'
import { StakingPoolCard } from '@/components/nesting/StakingPoolCard'
import { SectionHeader } from '@/components/council/SectionHeader'
import { EmptyState } from '@/components/council/EmptyState'
import { nestingMutedActionButtonClass } from '@/lib/nesting/ui-classes'
import { cn } from '@/lib/utils'

type Props = {
  initialPools: StakingPoolRow[]
}

export function NestingLandingClient({ initialPools }: Props) {
  const { connected, publicKey } = useWallet()
  /** null = loading / idle; -1 = need SIWS; >= 0 active count */
  const [positionPreview, setPositionPreview] = useState<number | null>(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setPositionPreview(null)
      return
    }
    let cancelled = false
    const addr = publicKey.toBase58()
    setPositionPreview(null)
    fetch('/api/me/staking/positions', {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'X-Connected-Wallet': addr },
    })
      .then((res) => {
        if (cancelled) return
        if (res.status === 401) {
          setPositionPreview(-1)
          return
        }
        return res.json().catch(() => null)
      })
      .then((json) => {
        if (cancelled || !json?.positions) return
        const active = (json.positions as unknown[]).filter(
          (p: unknown) => (p as { status?: string })?.status === 'active'
        ).length
        setPositionPreview(active)
      })
      .catch(() => {
        if (!cancelled) setPositionPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 pb-16 max-w-6xl space-y-12 sm:space-y-16">
      <NestingHero />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Layers,
            title: 'Stake assets',
            body: 'Pick a pool and record a mock stake in our database — rates snapshot at stake time.',
          },
          {
            icon: Coins,
            title: 'Earn rewards',
            body: 'Estimated rewards use time elapsed and your snapshot rate (no live chain scans).',
          },
          {
            icon: Shield,
            title: 'Lockups',
            body: 'Unlock timers are enforced in app logic until real custody ships.',
          },
          {
            icon: Bird,
            title: 'Ecosystem ready',
            body: 'Structured for Owltopia first and partner pools later.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <Card key={title} className="rounded-xl border-border/60 bg-card/80">
            <CardHeader className="pb-2">
              <Icon className="h-8 w-8 text-theme-prime mb-1" aria-hidden />
              <CardTitle className="text-base font-display tracking-wide">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {connected && positionPreview !== null && (
        <Card className="rounded-xl border-border/70 bg-muted/25">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Your nest</CardTitle>
              <CardDescription>
                {positionPreview === -1
                  ? 'Sign in on the staking dashboard (one wallet message) to load positions — no RPC.'
                  : positionPreview === 0
                    ? 'No active nest positions — open the dashboard to stake.'
                    : `${positionPreview} active position${positionPreview === 1 ? '' : 's'}.`}
              </CardDescription>
            </div>
            <Button asChild variant="outline" className={cn(nestingMutedActionButtonClass)}>
              <Link href="/dashboard/nesting">Open staking dashboard</Link>
            </Button>
          </CardHeader>
        </Card>
      )}

      <section id="pools" className="scroll-mt-24">
        <SectionHeader
          title="Available pools"
          description="Pools are configured in Owl Vision (admin). Token and NFT pool types reserve fields for future on-chain checks."
        />
        {initialPools.length === 0 ? (
          <EmptyState
            title="No active pools yet."
            body="Admins can create pools under Owl Vision → Owl Nesting admin."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {initialPools.map((pool) => (
              <li key={pool.id}>
                <StakingPoolCard pool={pool} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="FAQ" description="Quick answers for the MVP flow." />
        <div className="rounded-xl border border-border/60 bg-background/40 divide-y divide-border/60">
          {[
            {
              q: 'Does this lock tokens on-chain?',
              a: 'Not yet. Stakes are recorded in Supabase so UX and reward math can ship first; custody hooks will plug in later.',
            },
            {
              q: 'Why sign in on the dashboard?',
              a: 'Stake, unstake, and claim actions require the same SIWS session as the rest of Owltopia — your wallet signs a message once.',
            },
          ].map(({ q, a }) => (
            <div key={q} className="px-4 py-4 sm:px-5">
              <p className="font-medium text-sm text-foreground">{q}</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
