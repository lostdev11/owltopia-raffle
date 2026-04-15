'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  Trophy,
  Ticket,
  PlusCircle,
  Loader2,
  Medal,
  Crown,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  Users,
} from 'lucide-react'

const LEADERBOARD_MIN_YEAR = 2024

type LeaderboardEntry = {
  rank: number
  wallet: string
  value: number
}

type LeaderboardData = {
  rafflesEntered: LeaderboardEntry[]
  ticketsPurchased: LeaderboardEntry[]
  rafflesCreated: LeaderboardEntry[]
  ticketsSold: LeaderboardEntry[]
  rafflesWon: LeaderboardEntry[]
}

type ReferralLeaderboardApiResponse = {
  entries: Array<{ rank: number; wallet: string; referredUsers: number; referredTickets: number }>
  displayNames: Record<string, string>
}

type PeriodKind = 'all' | 'month' | 'year'

type LeaderboardPeriodMeta = {
  kind: PeriodKind
  year?: number
  month?: number
  label: string
  rangeStart?: string
  rangeEndExclusive?: string
}

function utcNowYm(): { year: number; month: number } {
  const d = new Date()
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

function clampYear(y: number): number {
  const max = new Date().getUTCFullYear()
  return Math.min(max, Math.max(LEADERBOARD_MIN_YEAR, y))
}

function buildLeaderboardApiUrl(kind: PeriodKind, year: number, month: number, yearOnly: number): string {
  if (kind === 'all') return '/api/leaderboard?period=all'
  if (kind === 'year') return `/api/leaderboard?period=year&year=${clampYear(yearOnly)}`
  const y = clampYear(year)
  const m = Math.min(12, Math.max(1, month))
  return `/api/leaderboard?period=month&year=${y}&month=${m}`
}

function formatWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function tableDescriptions(meta: LeaderboardPeriodMeta | null): {
  rafflesEntered: string
  ticketsPurchased: string
  rafflesCreated: string
  rafflesWon: string
  ticketsSold: string
} {
  const scope =
    meta == null || meta.kind === 'all' ? 'all time (UTC)' : meta.label

  const entered =
    meta == null || meta.kind === 'all'
      ? 'Users with the most distinct raffles participated in (confirmed entries). Display names are set in My Dashboard.'
      : `Users with the most distinct raffles participated in during this period (${scope}). Display names are set in My Dashboard.`

  const purchased =
    meta == null || meta.kind === 'all'
      ? 'Players who have bought the most tickets across all raffles (confirmed entries).'
      : `Players who bought the most tickets in this period (${scope}), ranked by confirmation time.`

  const created =
    meta == null || meta.kind === 'all'
      ? 'Creators who have launched the most raffles.'
      : `Creators who launched the most raffles in this period (${scope}).`

  const won =
    meta == null || meta.kind === 'all'
      ? 'Players who have won the most completed raffles on Owl Raffle.'
      : `Players with the most wins recorded in this period (${scope}), by winner selection time.`

  const sold =
    meta == null || meta.kind === 'all'
      ? 'Creators whose raffles have sold the most tickets (confirmed entries).'
      : `Creators whose raffles sold the most tickets in this period (${scope}).`

  return {
    rafflesEntered: entered,
    ticketsPurchased: purchased,
    rafflesCreated: created,
    rafflesWon: won,
    ticketsSold: sold,
  }
}

function LeaderboardTable({
  title,
  description,
  entries,
  valueLabel,
  icon: Icon,
  displayNames,
}: {
  title: string
  description: string
  entries: LeaderboardEntry[]
  valueLabel: string
  icon: React.ElementType
  displayNames: Record<string, string>
}) {
  return (
    <Card className="border-green-500/20 bg-black/40">
      <CardHeader className="pb-2 sm:pb-6">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Icon className="h-5 w-5 text-green-500 shrink-0" />
          {title}
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No data yet.</p>
        ) : (
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[64%]" />
              <col className="w-[24%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-green-500/20">
                <th className="text-left py-2.5 sm:py-2 font-medium">#</th>
                <th className="text-left py-2.5 sm:py-2 font-medium">Name</th>
                <th className="text-right py-2.5 sm:py-2 font-medium">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.wallet}-${e.rank}`} className="border-b border-border/50">
                  <td className="py-3 sm:py-2 align-middle">
                    {e.rank <= 3 ? (
                      <Medal
                        className={`h-5 w-5 inline ${
                          e.rank === 1
                            ? 'text-amber-400'
                            : e.rank === 2
                              ? 'text-slate-300'
                              : 'text-amber-700'
                        }`}
                        aria-label={`Rank ${e.rank}`}
                      />
                    ) : (
                      <span className="text-muted-foreground">{e.rank}</span>
                    )}
                  </td>
                  <td className="py-3 sm:py-2 text-xs sm:text-sm align-middle truncate" title={e.wallet}>
                    {displayNames[e.wallet] ? (
                      <span className="font-medium">{displayNames[e.wallet]}</span>
                    ) : (
                      <span className="font-mono">{formatWallet(e.wallet)}</span>
                    )}
                  </td>
                  <td className="py-3 sm:py-2 text-right font-medium align-middle">{e.value.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
]

export default function LeaderboardPage() {
  const initial = useMemo(() => utcNowYm(), [])
  const [periodKind, setPeriodKind] = useState<PeriodKind>('month')
  const [monthScope, setMonthScope] = useState(initial)
  const [calendarYear, setCalendarYear] = useState(initial.year)

  const [data, setData] = useState<LeaderboardData | null>(null)
  const [periodMeta, setPeriodMeta] = useState<LeaderboardPeriodMeta | null>(null)
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({})
  const [referralLb, setReferralLb] = useState<ReferralLeaderboardApiResponse | null>(null)
  const [referralLbLoading, setReferralLbLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const maxYear = new Date().getUTCFullYear()
  const yearChoices = useMemo(() => {
    const out: number[] = []
    for (let y = maxYear; y >= LEADERBOARD_MIN_YEAR; y--) out.push(y)
    return out
  }, [maxYear])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const url = buildLeaderboardApiUrl(periodKind, monthScope.year, monthScope.month, calendarYear)
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load leaderboard')
      const json = await res.json()
      const { period, ...rest } = json as LeaderboardData & { period: LeaderboardPeriodMeta }
      setData(rest)
      setPeriodMeta(period ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      setData(null)
      setPeriodMeta(null)
    } finally {
      setLoading(false)
    }
  }, [periodKind, monthScope.year, monthScope.month, calendarYear])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    setReferralLbLoading(true)
    fetch('/api/referrals/leaderboard', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('referral lb'))))
      .then((json: ReferralLeaderboardApiResponse) => {
        if (!cancelled) setReferralLb(json)
      })
      .catch(() => {
        if (!cancelled) setReferralLb({ entries: [], displayNames: {} })
      })
      .finally(() => {
        if (!cancelled) setReferralLbLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const shiftMonth = (delta: number) => {
    setMonthScope(({ year: y, month: m }) => {
      let ny = y
      let nm = m + delta
      while (nm < 1) {
        nm += 12
        ny -= 1
      }
      while (nm > 12) {
        nm -= 12
        ny += 1
      }
      ny = clampYear(ny)
      return { year: ny, month: nm }
    })
  }

  useEffect(() => {
    if (!data) return
    const wallets = new Set<string>()
    data.rafflesEntered.forEach((e) => wallets.add(e.wallet))
    ;(data.ticketsPurchased ?? []).forEach((e) => wallets.add(e.wallet))
    data.rafflesCreated.forEach((e) => wallets.add(e.wallet))
    data.ticketsSold.forEach((e) => wallets.add(e.wallet))
    data.rafflesWon.forEach((e) => wallets.add(e.wallet))
    const list = [...wallets].slice(0, 200)
    if (list.length === 0) return
    const q = list.join(',')
    fetch(`/api/profiles?wallets=${encodeURIComponent(q)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((map: Record<string, string>) => setDisplayNames(map))
      .catch(() => setDisplayNames({}))
  }, [data])

  const descriptions = tableDescriptions(periodMeta)

  return (
    <div className="container mx-auto py-6 sm:py-8 px-3 sm:px-4 max-w-5xl min-h-0">
      <div className="flex items-center gap-3 sm:gap-4 mb-6">
        <Link href="/raffles" className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            className="touch-manipulation min-h-[44px] min-w-[44px] sm:min-w-0 px-3 sm:px-4 text-sm sm:text-base"
          >
            <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />
            Back to Raffles
          </Button>
        </Link>
      </div>

      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <Trophy className="h-6 w-6 sm:h-8 sm:w-8 text-green-500 shrink-0" />
          Leaderboard
        </h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Top 10 by activity. Monthly seasons use UTC (same window worldwide). Pick a past month or view all-time totals.
        </p>
        {periodMeta && (
          <p className="text-foreground/90 mt-2 text-sm font-medium" aria-live="polite">
            Showing: {periodMeta.label}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Leaderboard period">
          {(
            [
              { k: 'month' as const, label: 'Month' },
              { k: 'year' as const, label: 'Year' },
              { k: 'all' as const, label: 'All time' },
            ] as const
          ).map(({ k, label }) => (
            <Button
              key={k}
              type="button"
              variant={periodKind === k ? 'default' : 'outline'}
              size="sm"
              className="touch-manipulation min-h-[44px] px-4"
              onClick={() => setPeriodKind(k)}
              aria-pressed={periodKind === k}
            >
              {label}
            </Button>
          ))}
        </div>

        {periodKind === 'month' && (
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="touch-manipulation shrink-0 h-11 w-11 sm:h-10 sm:w-10"
                aria-label="Previous month"
                onClick={() => shiftMonth(-1)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="touch-manipulation shrink-0 h-11 w-11 sm:h-10 sm:w-10"
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm min-w-0 flex-1 sm:flex-initial">
              <span className="text-muted-foreground shrink-0">Month</span>
              <select
                className="flex-1 sm:w-auto min-w-0 rounded-md border border-input bg-background px-3 py-2.5 sm:py-2 text-sm touch-manipulation min-h-[44px]"
                value={monthScope.month}
                onChange={(e) => setMonthScope((s) => ({ ...s, month: Number(e.target.value) }))}
              >
                {MONTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm min-w-0 flex-1 sm:flex-initial">
              <span className="text-muted-foreground shrink-0">Year</span>
              <select
                className="flex-1 sm:w-[7.5rem] rounded-md border border-input bg-background px-3 py-2.5 sm:py-2 text-sm touch-manipulation min-h-[44px]"
                value={monthScope.year}
                onChange={(e) => setMonthScope((s) => ({ ...s, year: Number(e.target.value) }))}
              >
                {yearChoices.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {periodKind === 'year' && (
          <label className="flex items-center gap-2 text-sm max-w-xs">
            <span className="text-muted-foreground shrink-0">Year</span>
            <select
              className="flex-1 rounded-md border border-input bg-background px-3 py-2.5 sm:py-2 text-sm touch-manipulation min-h-[44px]"
              value={calendarYear}
              onChange={(e) => setCalendarYear(Number(e.target.value))}
            >
              {yearChoices.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
          Loading leaderboard…
        </div>
      )}

      {error && <p className="text-destructive py-4">{error}</p>}

      {!loading && !error && data && (
        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <LeaderboardTable
            title="Most raffles entered"
            description={descriptions.rafflesEntered}
            entries={data.rafflesEntered}
            valueLabel="Raffles"
            icon={Ticket}
            displayNames={displayNames}
          />
          <LeaderboardTable
            title="Most tickets purchased"
            description={descriptions.ticketsPurchased}
            entries={data.ticketsPurchased ?? []}
            valueLabel="Tickets"
            icon={ShoppingCart}
            displayNames={displayNames}
          />
          <LeaderboardTable
            title="Most raffles created"
            description={descriptions.rafflesCreated}
            entries={data.rafflesCreated}
            valueLabel="Raffles"
            icon={PlusCircle}
            displayNames={displayNames}
          />
          <LeaderboardTable
            title="Most raffles won"
            description={descriptions.rafflesWon}
            entries={data.rafflesWon}
            valueLabel="Wins"
            icon={Crown}
            displayNames={displayNames}
          />
          <LeaderboardTable
            title="Most tickets sold"
            description={descriptions.ticketsSold}
            entries={data.ticketsSold}
            valueLabel="Tickets"
            icon={Trophy}
            displayNames={displayNames}
          />
        </div>
      )}

      <div className="mt-10 sm:mt-12 space-y-3 max-w-5xl">
        <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Users className="h-5 w-5 sm:h-6 sm:w-6 text-green-500 shrink-0" />
          Most users referred
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          All-time (UTC). Top 10 referrers by how many different wallets bought at least one confirmed ticket using their
          link (refunded purchases excluded; dust purchases below minimum per currency do not count). Counts are aggregated on
          the server. Referral links set an httpOnly cookie so checkout cannot read or override the code from normal
          page JavaScript.
        </p>
        {referralLbLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-6">
            <Loader2 className="h-5 w-5 animate-spin shrink-0" />
            Loading referral leaderboard…
          </div>
        )}
        {!referralLbLoading && referralLb && (
          <div className="max-w-md">
            <LeaderboardTable
              title="Distinct buyers referred"
              description="Same rules as above including minimum purchase; ties broken by total referred ticket rows."
              entries={referralLb.entries.map((e) => ({
                rank: e.rank,
                wallet: e.wallet,
                value: e.referredUsers,
              }))}
              valueLabel="Users"
              icon={Users}
              displayNames={{ ...displayNames, ...referralLb.displayNames }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
