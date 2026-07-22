'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Bird, Coins, Layers, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { NestingHero } from '@/components/nesting/NestingHero'
import { NestingGlobalOwlNestProgress } from '@/components/nesting/NestingGlobalOwlNestProgress'
import { NestingGlobalGenOwlNestProgress } from '@/components/nesting/NestingGlobalGenOwlNestProgress'
import type { OwlNest365PublicStats } from '@/lib/nesting/owl-nest-365-stats'
import type { GenOwlNestPublicStats } from '@/lib/nesting/gen-owl-nest-stats'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import { StakingPoolCard } from '@/components/nesting/StakingPoolCard'
import { ConsolidatedGenOwlStakingCard } from '@/components/nesting/ConsolidatedGenOwlStakingCard'
import { buildNestingPerchDisplayList } from '@/lib/nesting/gen-owl-staking-groups'
import { filterPoolsForPublicNestingCatalog } from '@/lib/nesting/perch-catalog'
import { GOMT_MIGRATION_FAQ } from '@/lib/nesting/gomt-migration-copy'
import { SectionHeader } from '@/components/council/SectionHeader'
import { EmptyState } from '@/components/council/EmptyState'
import { nestingMutedActionButtonClass } from '@/lib/nesting/ui-classes'
import { NestingGomtMigrationNotice } from '@/components/nesting/NestingGomtMigrationNotice'
import { cn } from '@/lib/utils'

/** One perch per dashboard visit — multi-perch sites start at the perch list. */
function defaultDashboardNestingHref(pools: StakingPoolRow[]): string {
  const publicPools = filterPoolsForPublicNestingCatalog(pools)
  if (publicPools.length === 1) {
    return `/dashboard/nesting?pool=${encodeURIComponent(publicPools[0]!.slug)}`
  }
  return '/nesting#perches'
}

type Props = {
  initialPools: StakingPoolRow[]
  initialOwlNest365Stats?: OwlNest365PublicStats | null
  initialGenOwlNestStats?: Partial<Record<GenOwlStakingGroupKey, GenOwlNestPublicStats>>
  /** Server: global pause (deployment env and/or admin “pause holder actions” in Owl Nesting admin). */
  nestingDisabled?: boolean
  nestingPausedByDeployEnv?: boolean
  nestingPausedByAdmin?: boolean
  /** True when viewer is a site admin (admin-preview perches may be included). */
  viewerIsAdmin?: boolean
}

export function NestingLandingClient({
  initialPools,
  initialOwlNest365Stats = null,
  initialGenOwlNestStats = {},
  nestingDisabled = false,
  nestingPausedByDeployEnv = false,
  nestingPausedByAdmin = false,
  viewerIsAdmin = false,
}: Props) {
  const { connected, publicKey } = useWallet()
  const hasAdminPreviewPools = viewerIsAdmin && initialPools.some((p) => p.admin_only === true)
  /** null = loading / idle; -1 = need SIWS; >= 0 active count */
  const [positionPreview, setPositionPreview] = useState<number | null>(null)
  const [claimableOwlPreview, setClaimableOwlPreview] = useState<number | null>(null)
  const dashboardNestHref = useMemo(
    () => defaultDashboardNestingHref(initialPools),
    [initialPools]
  )
  const displayPerches = useMemo(
    () => buildNestingPerchDisplayList(filterPoolsForPublicNestingCatalog(initialPools)),
    [initialPools]
  )
  const visibleGenGroups = useMemo(() => {
    const keys: GenOwlStakingGroupKey[] = []
    for (const item of displayPerches) {
      if (item.kind === 'gen_owl_group') keys.push(item.groupKey)
    }
    return keys
  }, [displayPerches])

  useEffect(() => {
    if (!connected || !publicKey) {
      setPositionPreview(null)
      setClaimableOwlPreview(null)
      return
    }
    let cancelled = false
    const addr = publicKey.toBase58()
    setPositionPreview(null)
    setClaimableOwlPreview(null)
    fetch(
      typeof window !== 'undefined'
        ? `${window.location.origin}/api/me/staking/positions?heal=0`
        : '/api/me/staking/positions?heal=0',
      {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Connected-Wallet': addr },
      }
    )
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
        const rows = json.positions as Array<{
          status?: string
          amount?: number
          reward_rate_snapshot?: number
          reward_rate_unit_snapshot?: string
          reward_token_snapshot?: string
          claimed_rewards?: number
          staked_at?: string
        }>
        const active = rows.filter((p) => p.status === 'active').length
        setPositionPreview(active)
        const now = Date.now()
        let claimable = 0
        for (const row of rows) {
          if (row.status !== 'active') continue
          if ((row.reward_token_snapshot ?? '').trim().toUpperCase() !== 'OWL') continue
          const stakedAtMs = row.staked_at ? new Date(row.staked_at).getTime() : 0
          if (!stakedAtMs) continue
          const elapsedMs = now - stakedAtMs
          if (elapsedMs <= 0) continue
          const amount = Number(row.amount) || 0
          const rate = Number(row.reward_rate_snapshot) || 0
          let accrued = 0
          if (row.reward_rate_unit_snapshot === 'hourly') {
            accrued = amount * rate * (elapsedMs / 3_600_000)
          } else if (row.reward_rate_unit_snapshot === 'weekly') {
            accrued = amount * rate * (elapsedMs / 604_800_000)
          } else {
            accrued = amount * rate * (elapsedMs / 86_400_000)
          }
          const pending = Math.max(0, accrued - Number(row.claimed_rewards ?? 0))
          if (pending >= 1) claimable += pending
        }
        setClaimableOwlPreview(claimable)
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
      <Link
        href="/raffles"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground min-h-[44px] py-2 touch-manipulation -mt-1"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        Back to raffles
      </Link>
      {nestingDisabled ? (
        <div
          className="rounded-xl border border-amber-500/45 bg-amber-500/[0.08] px-4 py-3 text-sm text-foreground"
          role="status"
        >
          <p className="font-medium text-foreground">Nesting is paused</p>
          <p className="mt-1 text-muted-foreground leading-relaxed">
            {nestingPausedByDeployEnv ? (
              <>
                This deployment has the <span className="font-mono">NESTING_DISABLED</span> environment flag set, so new
                nests, claims, and leaving a nest stay off until that is cleared on the host and a new deployment runs.
                Your existing nests stay put.
              </>
            ) : nestingPausedByAdmin ? (
              <>
                New nests and leaving a nest are paused. You can still claim OWL from{' '}
                <span className="font-medium text-foreground">My nest</span> on the dashboard.
              </>
            ) : (
              <>
                New nests, claims, and leaving a nest are temporarily turned off while we tend to things behind the
                scenes. Your existing nests stay put—check back soon or follow announcements for the all-clear.
              </>
            )}
          </p>
        </div>
      ) : null}
      <NestingGomtMigrationNotice />
      {hasAdminPreviewPools ? (
        <div
          className="rounded-xl border border-violet-500/40 bg-violet-500/[0.08] px-4 py-3 text-sm text-foreground"
          role="status"
        >
          <p className="font-medium text-foreground">Admin preview — Gen 1 &amp; Gen 2 perches</p>
          <p className="mt-1 text-muted-foreground leading-relaxed">
            Gen 1 and Gen 2 owl nesting is visible only to admins until launch. Tap{' '}
            <span className="font-medium text-foreground">Nest here</span>, pick 90 or 180 days when you stake, and
            use <span className="font-medium text-foreground">My nest</span> to test freeze, claim, and unstake on
            mobile and desktop.
          </p>
        </div>
      ) : null}
      <NestingHero />

      <div className="space-y-4">
        <NestingGlobalOwlNestProgress initialStats={initialOwlNest365Stats} />
        {visibleGenGroups.map((groupKey) => (
          <NestingGlobalGenOwlNestProgress
            key={groupKey}
            groupKey={groupKey}
            initialStats={initialGenOwlNestStats[groupKey] ?? null}
          />
        ))}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Layers,
            title: 'Pick your perch',
            body: 'Choose a perch that fits what you hold. Your reward rate locks in the moment you join.',
          },
          {
            icon: Coins,
            title: 'Rewards add up',
            body: 'Watch OWL drip in over time—you can tap claim whenever you like (daily is totally fine).',
          },
          {
            icon: Shield,
            title: 'Fair countdowns',
            body: 'Every perch spells out its lock timer. When it hits zero, you are free to spread your wings again.',
          },
          {
            icon: Bird,
            title: 'Built for Owltopia',
            body: 'Homegrown for Owl holders first—with room for partner nests down the road.',
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
                  ? 'Head to your dashboard and say hi with one wallet message—we will load your spots.'
                  : positionPreview === 0
                    ? 'No nests open yet—open your dashboard and pick a perch to start.'
                    : `${positionPreview} nest${positionPreview === 1 ? '' : 's'} whooing along.`}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {claimableOwlPreview != null && claimableOwlPreview >= 1 ? (
                <Button asChild variant="default" className="min-h-[48px] touch-manipulation font-semibold">
                  <Link href="/dashboard/nesting#nesting-claim-all-banner">
                    Claim {claimableOwlPreview.toLocaleString(undefined, { maximumFractionDigits: 2 })} OWL
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline" className={cn(nestingMutedActionButtonClass, 'min-h-[48px]')}>
                <Link href={dashboardNestHref}>Open my nest</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      <section id="perches" className="scroll-mt-24">
        <SectionHeader
          title="Open perches"
          description="Each card is a perch you can land on—locks, rates, and nest type are spelled out up front."
        />
        {initialPools.length === 0 ? (
          <EmptyState
            title="No perches live yet"
            body="Check back soon—new spots hatch here when admins flip them on."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayPerches.map((item) =>
              item.kind === 'gen_owl_group' ? (
                <li key={item.groupKey}>
                  <ConsolidatedGenOwlStakingCard
                    groupKey={item.groupKey}
                    tiers={item.tiers}
                    nestingPaused={nestingDisabled}
                  />
                </li>
              ) : (
                <li key={item.pool.id}>
                  <StakingPoolCard pool={item.pool} nestingPaused={nestingDisabled} />
                </li>
              )
            )}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="FAQ" />
        <div className="rounded-xl border border-border/60 bg-background/40 divide-y divide-border/60">
          {[
            ...GOMT_MIGRATION_FAQ,
            {
              q: 'Is there a platform fee for nesting?',
              a: 'Yes — when enabled, each nest action (stake, claim OWL, or leave nest) includes a small SOL platform fee per NFT. Your wallet will ask you to approve it before the action completes.',
            },
            {
              q: 'Does my wallet send tokens somewhere when I nest?',
              a: 'Not at first for every perch—we note your nest inside Owltopia so rewards spin up smoothly; stronger wallet vault upgrades roll out perch by perch.',
            },
            {
              q: 'When can I claim OWL rewards?',
              a: 'OWL accrues daily while nested, but you claim it yourself from My nest when you are ready — at least 1 OWL per nest claim, or use Claim all on mobile when multiple nests are ready.',
            },
            {
              q: 'Why do you ask me to sign a message on the dashboard?',
              a: 'So we never mix up nests between wallets—it is just a quick hey-it-is-you check, same vibe as signing in elsewhere in Owltopia. Ledger users: unlock, open the Solana app, enable Blind signing, then approve the short Sign Message prompt (USB on desktop is usually smoother than Bluetooth).',
            },
            {
              q: 'I use Ledger and the sign prompt never shows up',
              a: 'This is a known Phantom/Solflare + Ledger gap for Sign Message. On My nest, tap “Sign with Ledger / wallet” instead — approve the memo on the device (not broadcast, no Owltopia fee). Keep the Solana app open, Ledger Live closed, and prefer USB on desktop. Phantom may add a Lighthouse security check to that memo — that is expected. If it still fails, sign in once from a hot wallet, then switch back for nesting.',
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
