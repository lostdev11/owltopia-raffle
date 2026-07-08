'use client'

import Link from 'next/link'
import {
  Award,
  BarChart3,
  Bird,
  ChevronRight,
  Coins,
  Gift,
  Landmark,
  LayoutDashboard,
  Sparkles,
  Ticket,
  Trophy,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import type { DashboardEngagementPayload } from '@/lib/xp/engagement-payload'
import { MILESTONE_BETA_NOTICE } from '@/lib/raffles/milestones/copy'
import { DashboardCollapsible } from '@/components/dashboard/DashboardCollapsible'

export type DashboardOverviewStats = {
  rafflesEntered: number
  ticketsEntered: number
  wins: number
  hostedRaffles: number
  pendingClaims: number
  prizesToClaim: number
}

function formatMultiCurrency(by: Record<string, number>): string {
  const keys = Object.keys(by)
  if (keys.length === 0) return '—'
  return keys
    .map((cur) => {
      const v = by[cur]!
      const decimals = cur === 'USDC' || cur === 'OWL' ? 2 : 4
      return `${v.toFixed(decimals)} ${cur}`
    })
    .join(' · ')
}

function OverviewMetricCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  accent: string
}) {
  return (
    <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm overflow-hidden">
      <CardHeader className="space-y-2 pb-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-xl font-bold tabular-nums tracking-tight sm:text-2xl">{value}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground leading-snug">{hint}</p> : null}
      </CardHeader>
    </Card>
  )
}

function QuickNavCard({
  title,
  description,
  badge,
  icon,
  onClick,
}: {
  title: string
  description: string
  badge?: string | null
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] w-full flex-col gap-2 rounded-xl border border-border/60 bg-card/90 p-4 text-left shadow-sm touch-manipulation transition-colors hover:bg-muted/30"
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary`}>
          {icon}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </span>
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {badge ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500 ring-1 ring-emerald-500/25">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground leading-relaxed">{description}</span>
    </button>
  )
}

export function DashboardOverviewSection({
  engagement,
  feeTier,
  partnerDisplayName,
  creatorRevenueByCurrency,
  creatorLiveEarningsByCurrency,
  creatorAllTimeGrossByCurrency,
  stats,
  onNavigateTab,
}: {
  engagement: DashboardEngagementPayload
  feeTier: { feeBps: number; reason: string }
  partnerDisplayName: string | null
  creatorRevenueByCurrency: Record<string, number>
  creatorLiveEarningsByCurrency: Record<string, number>
  creatorAllTimeGrossByCurrency: Record<string, number>
  stats: DashboardOverviewStats
  onNavigateTab: (tab: 'hosting' | 'analytics' | 'winnings') => void
}) {
  const milestonesDone = engagement.milestones.filter((m) => m.done).length
  const feeLabel =
    feeTier.feeBps === 300 ? '3%' : feeTier.feeBps === 600 ? '6%' : `${(feeTier.feeBps / 100).toFixed(1)}%`
  const feeReason =
    feeTier.reason === 'holder'
      ? 'Owltopia holder rate'
      : feeTier.reason === 'partner_community'
        ? partnerDisplayName
          ? `Partner · ${partnerDisplayName}`
          : 'Partner — set display name in Wallet tab'
        : 'Standard rate'
  const hasCreatorActivity = Object.keys(creatorAllTimeGrossByCurrency).length > 0

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Bird className="h-5 w-5 text-emerald-400" aria-hidden />
          Your Owltopia dashboard
        </h2>
        <p className="text-sm text-muted-foreground">
          Level, earnings, entries, and quick links — everything at a glance.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <OverviewMetricCard
          icon={<Award className="h-4 w-4 text-amber-300" aria-hidden />}
          label="Level & XP"
          value={`Lv ${engagement.level}`}
          hint={`${engagement.totalXp.toLocaleString()} XP · ${milestonesDone}/${engagement.milestones.length} milestones`}
          accent="bg-amber-500/15"
        />
        <OverviewMetricCard
          icon={<Ticket className="h-4 w-4 text-blue-300" aria-hidden />}
          label="Raffles entered"
          value={stats.rafflesEntered.toLocaleString()}
          hint={`${stats.ticketsEntered.toLocaleString()} ticket${stats.ticketsEntered === 1 ? '' : 's'} total`}
          accent="bg-blue-500/15"
        />
        <OverviewMetricCard
          icon={<Trophy className="h-4 w-4 text-violet-300" aria-hidden />}
          label="Wins"
          value={stats.wins.toLocaleString()}
          hint={stats.prizesToClaim > 0 ? `${stats.prizesToClaim} prize${stats.prizesToClaim === 1 ? '' : 's'} to claim` : 'NFT & crypto prizes'}
          accent="bg-violet-500/15"
        />
        <OverviewMetricCard
          icon={<LayoutDashboard className="h-4 w-4 text-teal-300" aria-hidden />}
          label="Hosted raffles"
          value={stats.hostedRaffles.toLocaleString()}
          hint={stats.pendingClaims > 0 ? `${stats.pendingClaims} ready to claim` : 'Raffles you created'}
          accent="bg-teal-500/15"
        />
        <OverviewMetricCard
          icon={<Coins className="h-4 w-4 text-emerald-300" aria-hidden />}
          label="Creator revenue"
          value={formatMultiCurrency(creatorRevenueByCurrency)}
          hint="Net after platform fee (claimed + live)"
          accent="bg-emerald-500/15"
        />
        <OverviewMetricCard
          icon={<Landmark className="h-4 w-4 text-indigo-300" aria-hidden />}
          label="Gross sales"
          value={formatMultiCurrency(creatorAllTimeGrossByCurrency)}
          hint="Confirmed ticket volume before fees"
          accent="bg-indigo-500/15"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <QuickNavCard
          title="Hosting"
          description="Claim creator proceeds, track live escrow, and manage your raffles."
          badge={stats.pendingClaims > 0 ? `${stats.pendingClaims} to claim` : null}
          icon={<Landmark className="h-4 w-4" aria-hidden />}
          onClick={() => onNavigateTab('hosting')}
        />
        <QuickNavCard
          title="Analytics"
          description="Views, sell-through, referrals, and performance trends for your raffles."
          icon={<BarChart3 className="h-4 w-4" aria-hidden />}
          onClick={() => onNavigateTab('analytics')}
        />
        <QuickNavCard
          title="Wins"
          description="Claim NFT prizes, giveaways, and see tickets you entered."
          badge={stats.prizesToClaim > 0 ? `${stats.prizesToClaim} ready` : null}
          icon={<Gift className="h-4 w-4" aria-hidden />}
          onClick={() => onNavigateTab('winnings')}
        />
      </div>

      <Card className="rounded-xl border-amber-500/25 bg-gradient-to-br from-amber-500/[0.07] to-violet-500/[0.04] shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-400" aria-hidden />
            Creator tools
          </CardTitle>
          <CardDescription>
            Grow ticket sales with milestone bonuses and track performance in Analytics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-500/20 bg-background/60 p-4 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Gift className="h-4 w-4 text-amber-400" aria-hidden />
                Milestone Rewards
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{MILESTONE_BETA_NOTICE}</p>
              <Button asChild size="sm" className="min-h-[44px] w-full touch-manipulation sm:w-auto">
                <Link href="/create">Add milestones to a raffle</Link>
              </Button>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-background/60 p-4 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <BarChart3 className="h-4 w-4 text-violet-400" aria-hidden />
                Creator Analytics
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Views, sell-through, referral traffic, and estimated net revenue after your {feeLabel} platform fee.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px] w-full touch-manipulation sm:w-auto"
                onClick={() => onNavigateTab('analytics')}
              >
                Open Analytics
              </Button>
            </div>
          </div>
          {feeTier.reason === 'partner_community' ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Partner Pro: use SPL ticket currencies and partner raffles from{' '}
              <Link
                href="/partners/dashboard"
                className="inline-flex min-h-[44px] items-center text-primary underline-offset-4 hover:underline touch-manipulation"
              >
                Partner dashboard
              </Link>
              .
            </p>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Want lower fees and partner tooling?{' '}
              <Link
                href="/partner-program"
                className="inline-flex min-h-[44px] items-center text-primary underline-offset-4 hover:underline touch-manipulation"
              >
                Apply to the partner program
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Details</CardTitle>
          <CardDescription>Expand a section for XP milestones, fees, and earnings breakdown.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DashboardCollapsible
            title="Level progress & milestones"
            count={engagement.milestones.length}
            readyLabel={
              engagement.xpToNext != null && engagement.xpToNext > 0
                ? `${engagement.xpIntoLevel}/${engagement.xpToNext} XP`
                : milestonesDone < engagement.milestones.length
                  ? `${milestonesDone} done`
                  : null
            }
            defaultOpen={milestonesDone < engagement.milestones.length && milestonesDone > 0}
          >
            {engagement.xpToNext != null && engagement.xpToNext > 0 ? (
              <div className="space-y-1.5">
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={engagement.xpToNext}
                  aria-valuenow={engagement.xpIntoLevel}
                  aria-label="Experience toward next level"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((100 * engagement.xpIntoLevel) / engagement.xpToNext)
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Level {engagement.level} · {engagement.totalXp.toLocaleString()} XP total
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Max level reached.</p>
            )}
            <ul className="scrollbar-themed mt-2 max-h-64 space-y-2 overflow-y-auto pr-1 text-xs text-muted-foreground">
              {engagement.milestones.map((m) => (
                <li
                  key={m.key}
                  className={`flex gap-2 rounded-md border border-border/50 p-2 ${m.done ? 'bg-muted/40' : 'bg-transparent'}`}
                >
                  <span className="shrink-0 pt-0.5" aria-hidden>
                    {m.done ? (
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    ) : (
                      <span className="inline-block h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{m.title}</span>
                    <span className="text-muted-foreground"> · +{m.xp} XP</span>
                    <span className="mt-0.5 block leading-snug">{m.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </DashboardCollapsible>

          <DashboardCollapsible
            title="Fee tier & how payouts work"
            defaultOpen={false}
            description={feeReason}
          >
            <div className="rounded-lg border border-border/50 bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">Platform fee on new raffles</p>
              <p className="text-2xl font-bold tabular-nums">{feeLabel}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              New raffles use funds escrow. The platform fee and your net share are sent when you claim after the draw.
              Older raffles may use split-at-purchase.
            </p>
          </DashboardCollapsible>

          {hasCreatorActivity ? (
            <DashboardCollapsible
              title="Earnings breakdown"
              defaultOpen={stats.pendingClaims > 0}
              description="Claimed net revenue plus live escrow estimates from active raffles."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Net creator revenue</p>
                  <p className="text-lg font-bold tabular-nums">{formatMultiCurrency(creatorRevenueByCurrency)}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                  <p className="text-xs text-muted-foreground">Gross ticket sales</p>
                  <p className="text-lg font-bold tabular-nums">{formatMultiCurrency(creatorAllTimeGrossByCurrency)}</p>
                </div>
              </div>
              {Object.keys(creatorLiveEarningsByCurrency).length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Live in escrow (estimated net):{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatMultiCurrency(creatorLiveEarningsByCurrency)}
                  </span>
                </p>
              ) : null}
              {stats.pendingClaims > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  className="min-h-[44px] touch-manipulation"
                  onClick={() => onNavigateTab('hosting')}
                >
                  Go to Hosting to claim
                </Button>
              ) : null}
            </DashboardCollapsible>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
