'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Loader2,
  Eye,
  Ticket,
  Users,
  DollarSign,
  Share2,
  Coins,
  Download,
  Info,
  TrendingUp,
  TrendingDown,
  Bird,
  Gift,
} from 'lucide-react'
import { OWL_TICKER } from '@/lib/council/owl-ticker'
import type {
  CreatorAnalyticsDailyPoint,
  CreatorAnalyticsPayload,
  CreatorRaffleAnalyticsRow,
} from '@/lib/db/creator-analytics'

const PERIOD_OPTIONS = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: 'all' },
] as const

function pct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function formatGrowth(n: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
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

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function raffleStatusLabel(status: string | null, endTime: string): string {
  const s = (status ?? '').toLowerCase()
  if (s === 'completed' || s === 'drawn' || s === 'ended') return 'Completed'
  if (s === 'failed_refund_available') return 'Refunding'
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'pending_min_not_met') return 'Min not met'
  if (s === 'active' || s === 'live') {
    const end = new Date(endTime)
    if (end.getTime() > Date.now()) return 'Active'
    return 'Ended'
  }
  if (s.includes('_')) {
    return s
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Active'
}

function raffleTimeHint(endTime: string, status: string | null): string {
  const end = new Date(endTime)
  const label = raffleStatusLabel(status, endTime)
  if (label === 'Completed' || label === 'Ended') {
    return `Ended ${formatDistanceToNow(end, { addSuffix: true })}`
  }
  if (end.getTime() > Date.now()) {
    return `Ends in ${formatDistanceToNow(end)}`
  }
  return `Ended ${formatDistanceToNow(end, { addSuffix: true })}`
}

function exportCsv(data: CreatorAnalyticsPayload) {
  const headers = [
    'Raffle',
    'Slug',
    'Views',
    'Tickets Sold',
    'Unique Buyers',
    'Revenue',
    'Referral Tickets',
    'Referral Revenue',
    'Sell-Through',
    'Status',
  ]
  const lines = data.raffles.map((r) =>
    [
      `"${r.title.replace(/"/g, '""')}"`,
      r.slug,
      r.views,
      r.confirmedTickets,
      r.uniqueBuyers,
      `"${formatMultiCurrency(r.grossRevenueByCurrency)}"`,
      r.referralTickets,
      `"${formatMultiCurrency(r.referralRevenueByCurrency)}"`,
      pct(r.sellThroughRate),
      raffleStatusLabel(r.status, r.endTime),
    ].join(',')
  )
  const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `owltopia-creator-analytics-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function GrowthBadge({ value }: { value: number | null }) {
  const text = formatGrowth(value)
  if (text == null) return null
  const positive = (value ?? 0) >= 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
        positive ? 'text-emerald-500' : 'text-rose-400'
      }`}
    >
      {positive ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
      {text}
    </span>
  )
}

function MetricCard({
  icon,
  label,
  value,
  growth,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  growth: number | null
  accent: string
}) {
  return (
    <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm overflow-hidden">
      <CardHeader className="space-y-2 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
          <GrowthBadge value={growth} />
        </div>
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className="text-xl font-bold tabular-nums tracking-tight sm:text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function PerformanceChart({ series }: { series: CreatorAnalyticsDailyPoint[] }) {
  const { paths, labels, hasData } = useMemo(() => {
    if (series.length === 0) return { paths: [], labels: [] as string[], hasData: false }

    const w = 100
    const h = 48
    const pad = 2
    const maxCount = Math.max(
      1,
      ...series.flatMap((p) => [p.views, p.tickets, p.uniqueBuyers])
    )
    const maxRev = Math.max(1, ...series.map((p) => p.revenue))

    const toX = (i: number) => pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2)
    const toYCount = (v: number) => h - pad - (v / maxCount) * (h - pad * 2)
    const toYRev = (v: number) => h - pad - (v / maxRev) * (h - pad * 2)

    const line = (key: 'views' | 'tickets' | 'uniqueBuyers' | 'revenue', useRev = false) => {
      const pts = series.map((p, i) => {
        const v = key === 'revenue' ? p.revenue : p[key]
        const y = useRev ? toYRev(v) : toYCount(v)
        return `${toX(i)},${y}`
      })
      return pts.join(' ')
    }

    const tickLabels =
      series.length <= 1
        ? [series[0]?.date ?? '']
        : [series[0]!.date, series[Math.floor(series.length / 2)]!.date, series[series.length - 1]!.date]

    return {
      hasData: true,
      labels: tickLabels.map((d) => {
        try {
          return parseISO(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        } catch {
          return d
        }
      }),
      paths: [
        { key: 'views', color: '#a78bfa', d: line('views'), dash: undefined },
        { key: 'tickets', color: '#60a5fa', d: line('tickets'), dash: undefined },
        { key: 'buyers', color: '#2dd4bf', d: line('uniqueBuyers'), dash: undefined },
        { key: 'revenue', color: '#fbbf24', d: line('revenue', true), dash: '4 2' },
      ],
    }
  }, [series])

  if (!hasData) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Not enough activity in this period for a trend chart yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <svg viewBox="0 0 100 48" className="h-40 w-full text-muted-foreground/30" preserveAspectRatio="none" role="img" aria-label="Performance trend chart">
        {[12, 24, 36].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeWidth="0.15" />
        ))}
        {paths.map((p) => (
          <polyline
            key={p.key}
            fill="none"
            stroke={p.color}
            strokeWidth="0.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={p.dash}
            points={p.d}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-violet-400" aria-hidden /> Views
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-400" aria-hidden /> Tickets
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-teal-400" aria-hidden /> Buyers
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden /> Revenue
        </span>
      </div>
    </div>
  )
}

function ConversionFunnel({ funnel }: { funnel: CreatorAnalyticsPayload['funnel'] }) {
  const steps = [
    {
      label: 'Raffle views',
      value: funnel.raffleViews,
      pctOfTop: 100,
      bg: 'from-violet-500/80 to-violet-600/60',
    },
    {
      label: 'Referral visits',
      value: funnel.referralVisits,
      pctOfTop: funnel.raffleViews > 0 ? (funnel.referralVisits / funnel.raffleViews) * 100 : 0,
      bg: 'from-blue-500/80 to-blue-600/60',
    },
    {
      label: 'Tickets purchased',
      value: funnel.ticketsPurchased,
      pctOfTop: funnel.raffleViews > 0 ? (funnel.ticketsPurchased / funnel.raffleViews) * 100 : 0,
      bg: 'from-teal-500/80 to-teal-600/60',
    },
    {
      label: 'Unique buyers',
      value: funnel.uniqueBuyers,
      pctOfTop: funnel.raffleViews > 0 ? (funnel.uniqueBuyers / funnel.raffleViews) * 100 : 0,
      bg: 'from-amber-500/80 to-amber-600/60',
    },
  ]

  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const widthPct = Math.max(28, 100 - i * 14)
        return (
          <div key={step.label} className="flex flex-col items-center">
            <div
              className={`relative flex min-h-[52px] w-full items-center justify-center rounded-lg bg-gradient-to-r ${step.bg} px-3 py-2 text-center shadow-sm transition-all`}
              style={{ maxWidth: `${widthPct}%` }}
            >
              <div>
                <p className="text-lg font-bold tabular-nums text-white">{formatCompact(step.value)}</p>
                <p className="text-[11px] font-medium text-white/90">{step.label}</p>
              </div>
            </div>
            {i > 0 ? (
              <p className="py-0.5 text-[10px] tabular-nums text-muted-foreground">{step.pctOfTop.toFixed(1)}%</p>
            ) : (
              <div className="h-3" aria-hidden />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ReferrerAvatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
      <Bird className="h-4 w-4 text-emerald-400" aria-hidden />
      <span className="sr-only">{name}</span>
      <span
        className="absolute inset-0 flex items-center justify-center text-xs font-bold text-emerald-300/90"
        aria-hidden
      >
        {initial}
      </span>
    </span>
  )
}

function RaffleRow({ row }: { row: CreatorRaffleAnalyticsRow }) {
  const status = raffleStatusLabel(row.status, row.endTime)
  const isActive = status === 'Active'
  const isRefund = status === 'Refunding' || status === 'Min not met'

  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-muted/20">
      <td className="px-2 py-2.5 sm:px-3">
        <Link
          href={`/raffles/${encodeURIComponent(row.slug)}`}
          className="flex min-h-[44px] items-center gap-2 touch-manipulation sm:gap-2.5"
        >
          <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border/50 sm:h-10 sm:w-10 sm:rounded-lg">
            {row.imageUrl ? (
              <Image src={row.imageUrl} alt="" fill className="object-cover" sizes="40px" unoptimized />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Bird className="h-4 w-4 text-emerald-500/70" aria-hidden />
              </span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{raffleTimeHint(row.endTime, row.status)}</span>
          </span>
        </Link>
      </td>
      <td className="px-1.5 py-2.5 text-xs tabular-nums sm:text-sm">{row.views.toLocaleString()}</td>
      <td className="px-1.5 py-2.5 text-xs tabular-nums sm:text-sm">{row.confirmedTickets.toLocaleString()}</td>
      <td className="px-1.5 py-2.5 text-xs tabular-nums sm:text-sm">{row.uniqueBuyers.toLocaleString()}</td>
      <td className="px-1.5 py-2.5 text-xs tabular-nums sm:text-sm">
        {formatMultiCurrency(row.grossRevenueByCurrency)}
      </td>
      <td className="px-1.5 py-2.5 text-xs tabular-nums sm:text-sm">{row.referralTickets.toLocaleString()}</td>
      <td className="px-1.5 py-2.5 text-xs tabular-nums sm:text-sm">
        {formatMultiCurrency(row.referralRevenueByCurrency)}
      </td>
      <td className="px-1.5 py-2.5 text-xs tabular-nums sm:text-sm">{pct(row.sellThroughRate)}</td>
      <td className="px-2 py-2.5 sm:px-3">
        <span
          className={`inline-flex max-w-full whitespace-normal rounded-full px-2 py-0.5 text-center text-[10px] font-medium leading-tight sm:text-[11px] ${
            isActive
              ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30'
              : isRefund
                ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                : 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
          }`}
        >
          {status}
        </span>
      </td>
    </tr>
  )
}

export function CreatorAnalyticsSection() {
  const [period, setPeriod] = useState<string>('30')
  const [data, setData] = useState<CreatorAnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = period === 'all' ? 'days=all' : `days=${encodeURIComponent(period)}`
      const res = await fetch(`/api/creator/analytics?${qs}`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load analytics')
      setData((await res.json()) as CreatorAnalyticsPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    void load()
  }, [load])

  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? 'Last 30 days'

  if (loading && !data) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span>Loading creator analytics…</span>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="rounded-xl border-destructive/40">
        <CardContent className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} className="min-h-[44px] touch-manipulation">
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data || data.totals.rafflesCreated === 0) {
    return (
      <Card className="rounded-xl border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] to-violet-500/[0.04]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bird className="h-5 w-5 text-emerald-400" aria-hidden />
            Creator Analytics
          </CardTitle>
          <CardDescription>
            Host your first raffle on Owltopia to track views, ticket sales, referrals, and {OWL_TICKER} rewards here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="min-h-[44px] touch-manipulation">
            <Link href="/create">Create a raffle</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { totals, growth, funnel, referralInsights, dailySeries, topReferrers, raffles } = data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            Creator Analytics
            <span title="Performance for raffles you host">
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Track your raffle performance, referrals, and growth on Owltopia.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="analytics-period">
            Date range
          </label>
          <select
            id="analytics-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="min-h-[44px] rounded-lg border border-border/60 bg-background/80 px-3 text-sm touch-manipulation"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation gap-2"
            onClick={() => exportCsv(data)}
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Updating…
        </div>
      ) : null}

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          icon={<Eye className="h-4 w-4 text-violet-300" aria-hidden />}
          label="Views"
          value={totals.views.toLocaleString()}
          growth={growth.views}
          accent="bg-violet-500/15"
        />
        <MetricCard
          icon={<Ticket className="h-4 w-4 text-blue-300" aria-hidden />}
          label="Tickets sold"
          value={totals.confirmedTickets.toLocaleString()}
          growth={growth.tickets}
          accent="bg-blue-500/15"
        />
        <MetricCard
          icon={<Users className="h-4 w-4 text-teal-300" aria-hidden />}
          label="Unique buyers"
          value={totals.uniqueBuyers.toLocaleString()}
          growth={growth.uniqueBuyers}
          accent="bg-teal-500/15"
        />
        <MetricCard
          icon={<DollarSign className="h-4 w-4 text-amber-300" aria-hidden />}
          label="Gross revenue"
          value={formatMultiCurrency(totals.grossRevenueByCurrency)}
          growth={growth.grossRevenue}
          accent="bg-amber-500/15"
        />
        <MetricCard
          icon={<Share2 className="h-4 w-4 text-indigo-300" aria-hidden />}
          label="Referral tickets"
          value={totals.referralTickets.toLocaleString()}
          growth={growth.referralTickets}
          accent="bg-indigo-500/15"
        />
        <MetricCard
          icon={<Coins className="h-4 w-4 text-emerald-300" aria-hidden />}
          label="Referral revenue"
          value={formatMultiCurrency(totals.referralRevenueByCurrency)}
          growth={growth.referralRevenue}
          accent="bg-emerald-500/15"
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="rounded-xl border-border/60 bg-card/90 lg:col-span-5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Performance overview</CardTitle>
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            </div>
            <CardDescription>Daily views, sales, buyers, and revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceChart series={dailySeries} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 bg-card/90 lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversion funnel</CardTitle>
            <CardDescription>From view to purchase</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <ConversionFunnel funnel={funnel} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 bg-card/90 lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top referrers</CardTitle>
            <CardDescription>Who drives ticket sales to your raffles</CardDescription>
          </CardHeader>
          <CardContent>
            {topReferrers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No referral-attributed sales in this period yet. Share your raffle links with referral codes to grow here.
              </p>
            ) : (
              <ul className="space-y-3">
                {topReferrers.map((ref, i) => (
                  <li key={ref.wallet} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <ReferrerAvatar name={ref.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{ref.displayName}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {ref.tickets} ticket{ref.tickets === 1 ? '' : 's'} ·{' '}
                        {formatMultiCurrency(ref.revenueByCurrency)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Raffle table — fluid width, no inner scroll on desktop */}
      <Card className="rounded-xl border-border/60 bg-card/90">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Raffle performance</CardTitle>
          <CardDescription>{periodLabel} · sell-through and referral breakdown per raffle</CardDescription>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[13%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border/60 text-left text-[11px] text-muted-foreground sm:text-xs">
                <th className="px-2 pb-2 font-medium sm:px-3">Raffle</th>
                <th className="px-1 pb-2 font-medium tabular-nums">Views</th>
                <th className="px-1 pb-2 font-medium tabular-nums">Tickets</th>
                <th className="px-1 pb-2 font-medium tabular-nums">Buyers</th>
                <th className="px-1 pb-2 font-medium tabular-nums">Revenue</th>
                <th className="px-1 pb-2 font-medium tabular-nums">Ref. tix</th>
                <th className="px-1 pb-2 font-medium tabular-nums">Ref. rev</th>
                <th className="px-1 pb-2 font-medium tabular-nums">Sell %</th>
                <th className="px-2 pb-2 font-medium sm:px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {raffles.map((r) => (
                <RaffleRow key={r.raffleId} row={r} />
              ))}
            </tbody>
          </table>
          <div className="mt-3 border-t border-border/40 pt-3 text-xs text-muted-foreground">
            {raffles.length} raffle{raffles.length === 1 ? '' : 's'}
          </div>
        </CardContent>
      </Card>

      {/* Referral insights */}
      <Card className="rounded-xl border-border/60 bg-gradient-to-b from-card/90 to-emerald-500/[0.04]">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Referral insights</CardTitle>
          <CardDescription>Growth program on your raffles</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border/50 bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">Referral conversion rate</p>
              <p className="text-2xl font-bold tabular-nums">{pct(referralInsights.referralConversionRate)}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">Referral visits</p>
              <p className="text-2xl font-bold tabular-nums">{referralInsights.referralVisits.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-background/50 p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Gift className="h-3.5 w-3.5" aria-hidden />
                Free entries earned
              </p>
              <p className="text-2xl font-bold tabular-nums">{referralInsights.freeEntriesEarned.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Image src="/owl token v1.png" alt="" width={16} height={16} className="rounded-full" unoptimized />
                {OWL_TICKER} rewards earned
              </p>
              <p className="text-2xl font-bold tabular-nums text-amber-400">
                {referralInsights.owlRewardsEarned.toFixed(1)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Data for {periodLabel.toLowerCase()}. Refreshes when you open this tab.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
