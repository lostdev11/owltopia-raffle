'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  Loader2,
  ArrowLeft,
  Users,
  LayoutDashboard,
  Radio,
  Copy,
  Check,
  CheckCircle2,
  Circle,
  Coins,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Shield,
  Download,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { isMobileDevice } from '@/lib/utils'
import { PLATFORM_NAME } from '@/lib/site-config'

const MOBILE_401_RETRY_DELAY_MS = 500

/** Shared layout + card chrome for a consistent partner hub look */
const PAGE_SHELL =
  'container max-w-3xl mx-auto px-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))]'
const CARD_SURFACE = 'rounded-2xl border border-border/60 bg-card shadow-sm'
const STAT_CARD = `${CARD_SURFACE} flex h-full flex-col`

type DashboardRaffle = {
  id: string
  slug: string
  title: string
  status: string | null
  end_time: string
  currency: string
  /** When false, raffle is direct-link / Discord-only (not on main /raffles feed). */
  list_on_platform?: boolean | null
}

const EMPTY_RAFFLES: DashboardRaffle[] = []

type CreatorRefundRow = {
  raffleId: string
  raffleSlug: string
  raffleTitle: string
  totalPending: number
}

type EscrowTrackerPayload = {
  netByCurrency: Record<string, number>
  feeByCurrency: Record<string, number>
  grossByCurrency: Record<string, number>
}

type DashboardPayload = {
  feeTier: { reason: string; feeBps: number }
  /** From GET /api/me/dashboard: session wallet in `admins` table */
  viewerIsSiteAdmin: boolean
  partnerDiscordTenantId?: string | null
  myRaffles: DashboardRaffle[] | null
  wallet: string
  creatorRevenue: number
  creatorRevenueByCurrency: Record<string, number>
  creatorLiveEarningsByCurrency: Record<string, number>
  creatorAllTimeGrossByCurrency: Record<string, number>
  claimTrackerLiveFundsEscrowSales: EscrowTrackerPayload
  creatorRefundRaffles: CreatorRefundRow[]
}

function formatCurrencyAmount(currency: string, amount: number): string {
  const decimals = currency === 'USDC' ? 2 : 4
  return `${amount.toFixed(decimals)} ${currency}`
}

function currencyMapToJoinedLine(by: Record<string, number>): string {
  const entries = Object.entries(by).filter(([, v]) => typeof v === 'number' && v > 0)
  return entries.map(([cur, amt]) => formatCurrencyAmount(cur, amt)).join(' + ') || '—'
}

function feePercentLabel(feeBps: number): string {
  if (feeBps === 300) return '3%'
  if (feeBps === 600) return '6%'
  if (feeBps === 200) return '2%'
  return `${(feeBps / 100).toFixed(1)}%`
}

function parseCurrencyRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v)
    if (typeof n === 'number' && Number.isFinite(n) && n !== 0) out[k] = n
  }
  return out
}

function bucketPipelineStatus(status: string | null): 'active' | 'completed' | 'attention' | 'draft' | 'other' {
  const s = (status ?? '').trim()
  if (s === 'live' || s === 'ready_to_draw' || s === 'successful_pending_claims') return 'active'
  if (s === 'completed') return 'completed'
  if (s === 'pending_min_not_met' || s === 'failed_refund_available' || s === 'cancelled') return 'attention'
  if (s === 'draft') return 'draft'
  return 'other'
}

function normalizeRaffleRow(raw: unknown): DashboardRaffle | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  const slug = typeof o.slug === 'string' ? o.slug : ''
  const title = typeof o.title === 'string' ? o.title : ''
  const end_time = typeof o.end_time === 'string' ? o.end_time : ''
  const currency = typeof o.currency === 'string' ? o.currency : ''
  if (!id || !slug) return null
  const listRaw = o.list_on_platform
  const list_on_platform =
    typeof listRaw === 'boolean'
      ? listRaw
      : listRaw === null
        ? null
        : undefined
  return {
    id,
    slug,
    title,
    status: typeof o.status === 'string' ? o.status : null,
    end_time,
    currency,
    list_on_platform,
  }
}

/**
 * Host-facing hub for partner program wallets: economics and pipeline summaries (from /api/me/dashboard),
 * setup checklist, Discord tenant, and links to the main dashboard (claims, hosting, refunds).
 * Anyone can open the URL; content requires connect + sign-in and (partner allowlist or site admin wallet).
 */
export default function PartnerHostDashboardPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [loading, setLoading] = useState(true)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [retried401, setRetried401] = useState(false)
  const [exportingRaffleId, setExportingRaffleId] = useState<string | null>(null)

  const load = useCallback(async (silent: boolean) => {
    if (!publicKey) return
    if (!silent) {
      setLoading(true)
      setError(null)
      setNeedsSignIn(false)
    }
    const addr = publicKey.toBase58()
    try {
      const res = await fetch('/api/me/dashboard', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Connected-Wallet': addr },
      })
      if (res.status === 401) {
        if (isMobileDevice() && !retried401 && !silent) {
          setRetried401(true)
          setTimeout(() => void load(true), MOBILE_401_RETRY_DELAY_MS)
          return
        }
        setNeedsSignIn(true)
        setData(null)
        return
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Could not load')
        setData(null)
        return
      }
      if (json.wallet && json.wallet !== addr) {
        setNeedsSignIn(true)
        setData(null)
        return
      }
      const feeTier = json.feeTier as { reason?: string; feeBps?: number } | undefined
      const rawRaffles = Array.isArray(json.myRaffles) ? json.myRaffles : []
      const myRaffles = rawRaffles.map(normalizeRaffleRow).filter((r): r is DashboardRaffle => r != null)

      const claimRaw = json.claimTrackerLiveFundsEscrowSales as Record<string, unknown> | undefined
      const claimTrackerLiveFundsEscrowSales: EscrowTrackerPayload = {
        netByCurrency: parseCurrencyRecord(claimRaw?.netByCurrency),
        feeByCurrency: parseCurrencyRecord(claimRaw?.feeByCurrency),
        grossByCurrency: parseCurrencyRecord(claimRaw?.grossByCurrency),
      }

      const refundRaw = Array.isArray(json.creatorRefundRaffles) ? json.creatorRefundRaffles : []
      const creatorRefundRaffles: CreatorRefundRow[] = refundRaw
        .map((row) => {
          if (!row || typeof row !== 'object') return null
          const r = row as Record<string, unknown>
          const raffleId = typeof r.raffleId === 'string' ? r.raffleId : ''
          const raffleSlug = typeof r.raffleSlug === 'string' ? r.raffleSlug : ''
          const raffleTitle = typeof r.raffleTitle === 'string' ? r.raffleTitle : 'Raffle'
          const totalPending = Number(r.totalPending)
          if (!raffleId || !Number.isFinite(totalPending) || totalPending <= 0) return null
          return { raffleId, raffleSlug, raffleTitle, totalPending }
        })
        .filter((r): r is CreatorRefundRow => r != null)

      setData({
        wallet: String(json.wallet ?? addr),
        feeTier: { reason: String(feeTier?.reason ?? 'standard'), feeBps: Number(feeTier?.feeBps ?? 0) },
        viewerIsSiteAdmin: json.viewerIsSiteAdmin === true,
        partnerDiscordTenantId: (json.partnerDiscordTenantId as string | null) ?? null,
        myRaffles,
        creatorRevenue: typeof json.creatorRevenue === 'number' ? json.creatorRevenue : 0,
        creatorRevenueByCurrency: parseCurrencyRecord(json.creatorRevenueByCurrency),
        creatorLiveEarningsByCurrency: parseCurrencyRecord(json.creatorLiveEarningsByCurrency),
        creatorAllTimeGrossByCurrency: parseCurrencyRecord(json.creatorAllTimeGrossByCurrency),
        claimTrackerLiveFundsEscrowSales,
        creatorRefundRaffles,
      })
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Failed to load')
        setData(null)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [publicKey, retried401])

  useEffect(() => {
    if (connected && publicKey) void load(false)
  }, [connected, publicKey, load])

  const isPartner = data?.feeTier.reason === 'partner_community'
  const viewerIsSiteAdmin = data?.viewerIsSiteAdmin === true
  const canAccessPartnerHub = Boolean(isPartner || viewerIsSiteAdmin)
  const adminPreviewMode = viewerIsSiteAdmin && !isPartner
  const canExportEntrantCsv = Boolean(isPartner || viewerIsSiteAdmin)
  const raffles = data?.myRaffles ?? EMPTY_RAFFLES

  const pipelineBuckets = useMemo(() => {
    const counts = { active: 0, completed: 0, attention: 0, draft: 0, other: 0 }
    for (const r of raffles) {
      counts[bucketPipelineStatus(r.status)]++
    }
    return counts
  }, [raffles])

  const mainFeedListedCount = useMemo(
    () => raffles.filter((r) => r.list_on_platform !== false).length,
    [raffles],
  )

  const copyTenant = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const downloadEntrantsCsv = async (r: DashboardRaffle) => {
    if (!publicKey) return
    setExportingRaffleId(r.id)
    setError(null)
    try {
      const res = await fetch(`/api/me/raffles/${encodeURIComponent(r.id)}/entrants/export`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Connected-Wallet': publicKey.toBase58() },
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        setError(typeof json.error === 'string' ? json.error : 'Could not download CSV')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition')
      const m = cd?.match(/filename="([^"]+)"/)
      a.download = m?.[1] ?? `entrants-${r.slug}.csv`
      a.rel = 'noopener'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setExportingRaffleId(null)
    }
  }

  if (!connected || !publicKey) {
    return (
      <div
        className={`min-h-[min(100dvh,880px)] bg-gradient-to-b from-violet-500/[0.06] via-background to-background ${PAGE_SHELL} pt-10 sm:pt-14`}
      >
        <Button asChild variant="ghost" size="sm" className="touch-manipulation -ml-2 min-h-[44px] mb-6 h-auto px-2">
          <Link href="/raffles?tab=partner-raffles" className="inline-flex items-center gap-2 text-muted-foreground">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Partner raffles
          </Link>
        </Button>
        <div className={`${CARD_SURFACE} overflow-hidden`}>
          <div className="border-b border-border/50 bg-muted/30 px-5 py-5 sm:px-8 sm:py-8">
            <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
              <Users className="h-6 w-6 shrink-0" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">Partner program</span>
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Host hub</h1>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
              Connect the wallet on your {PLATFORM_NAME} partner allowlist to see listing scope, Discord tenant id, and
              shortcuts. Claims stay on your main dashboard.
            </p>
          </div>
          <div className="px-5 py-6 sm:px-8">
            <div className="touch-manipulation min-h-[44px] [&_button]:min-h-[44px] [&_button]:w-full sm:[&_button]:w-auto">
              <WalletConnectButton />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className={`flex min-h-[50vh] items-center justify-center ${PAGE_SHELL} pt-16`}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-9 w-9 animate-spin" aria-label="Loading" />
          <p className="text-sm">Loading partner hub…</p>
        </div>
      </div>
    )
  }

  if (needsSignIn) {
    return (
      <div className={`min-h-[min(100dvh,720px)] bg-gradient-to-b from-violet-500/[0.06] via-background to-background ${PAGE_SHELL} pt-10`}>
        <Card className={CARD_SURFACE}>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Sign in required</CardTitle>
            <CardDescription className="text-base leading-relaxed">
              Sign the message in your wallet to use the partner hub (same as the main dashboard).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button type="button" onClick={() => void load(false)} className="min-h-[44px] touch-manipulation w-full sm:w-auto">
              Retry
            </Button>
            <Button asChild variant="outline" className="min-h-[44px] w-full touch-manipulation sm:w-auto">
              <Link href="/dashboard">Open full dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${PAGE_SHELL} pt-10`}>
        <Card className={`${CARD_SURFACE} border-destructive/30`}>
          <CardHeader>
            <CardTitle className="text-xl">Something went wrong</CardTitle>
            <CardDescription className="text-destructive">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => void load(false)} className="min-h-[44px] touch-manipulation">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (data && !canAccessPartnerHub) {
    return (
      <div className={`min-h-[min(100dvh,880px)] bg-gradient-to-b from-violet-500/[0.06] via-background to-background ${PAGE_SHELL} pt-8 sm:pt-10`}>
        <Button asChild variant="ghost" size="sm" className="touch-manipulation -ml-2 mb-6 min-h-[44px] h-auto px-2">
          <Link href="/raffles" className="inline-flex items-center gap-2 text-muted-foreground">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Raffles
          </Link>
        </Button>
        <Card className={CARD_SURFACE}>
          <CardHeader className="space-y-2 border-b border-border/50 pb-6">
            <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
              <Users className="h-5 w-5 shrink-0" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">Partner hub</span>
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Not on the allowlist yet</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              <span className="font-mono text-xs text-foreground/80">{wallet}</span>
              <span className="mt-2 block text-muted-foreground">
                This wallet is not on the partner program allowlist, or the row is inactive.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <p className="mb-4 text-sm font-medium text-foreground">Next steps</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="min-h-[44px] touch-manipulation w-full sm:w-auto">
                <Link href="/partner-program">Partner program</Link>
              </Button>
              <Button asChild variant="outline" className="min-h-[44px] touch-manipulation w-full sm:w-auto">
                <Link href="/dashboard">Main dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const tenantId = data?.partnerDiscordTenantId?.trim() || null

  if (!data) {
    return (
      <div className={`flex min-h-[50vh] items-center justify-center ${PAGE_SHELL} pt-16`}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-9 w-9 animate-spin" aria-label="Loading" />
          <p className="text-sm">Loading partner hub…</p>
        </div>
      </div>
    )
  }

  const discordOnlyCount = raffles.length - mainFeedListedCount
  const feeTier = data.feeTier
  const creatorRevenue = data.creatorRevenue
  const escrowGross = data.claimTrackerLiveFundsEscrowSales.grossByCurrency

  return (
    <div className={`min-h-[min(100dvh,1200px)] bg-gradient-to-b from-violet-500/[0.07] via-background to-background ${PAGE_SHELL} pt-6 sm:pt-10`}>
      <header className={`${CARD_SURFACE} mb-8 overflow-hidden`}>
        <div className="border-b border-border/50 bg-gradient-to-br from-muted/40 via-card to-violet-500/[0.04] px-5 py-6 sm:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
                <Users className="h-6 w-6 shrink-0" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-wider">Partner program</span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Host hub</h1>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {adminPreviewMode ? (
                  <>
                    Same layout partners see. Figures match your signed-in wallet. Compare with the public{' '}
                    <Link href="/raffles?tab=partner-raffles" className="font-medium text-primary underline-offset-2 hover:underline">
                      partner raffles
                    </Link>{' '}
                    tab. Claims stay on your main dashboard and admin tools.
                  </>
                ) : (
                  <>
                    Main feed listings are separate from the public{' '}
                    <Link href="/raffles?tab=partner-raffles" className="font-medium text-primary underline-offset-2 hover:underline">
                      partner raffles
                    </Link>{' '}
                    section. Set Discord webhooks in your server; money flows and claims live on your main dashboard.
                  </>
                )}
              </p>
              {adminPreviewMode && (
                <p className="mt-4 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Admin preview</span> — unlocked for site admins. Session
                  wallet is not on the partner allowlist for the 2% tier ({PLATFORM_NAME}).
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation sm:self-start"
              onClick={() => void load(false)}
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  <span className="sr-only">Refreshing</span>
                </>
              ) : (
                'Refresh'
              )}
            </Button>
          </div>
          <div className="mt-5 rounded-xl border border-border/50 bg-background/80 px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground break-all">
            {wallet}
          </div>
        </div>
      </header>

      {error && (
        <p className="mb-6 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {data.creatorRefundRaffles.length > 0 && (
        <Card className={`${CARD_SURFACE} mb-6 border-amber-500/35 bg-amber-500/[0.06]`}>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  Refund action needed on {data.creatorRefundRaffles.length} raffle
                  {data.creatorRefundRaffles.length === 1 ? '' : 's'}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Use the Hosting tab on your full dashboard for buyer refunds.
                </p>
              </div>
            </div>
            <Button asChild className="min-h-[44px] w-full shrink-0 touch-manipulation sm:w-auto">
              <Link href="/dashboard?tab=hosting">Open Hosting</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className={`${CARD_SURFACE} mb-6`}>
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Setup checklist</CardTitle>
          <CardDescription>Status at a glance; details are in the sections below.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          <ul className="divide-y divide-border/60">
            <li className="flex gap-3 px-5 py-4 sm:px-6">
              {adminPreviewMode ? (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
              )}
              <span className="min-w-0 text-sm leading-relaxed">
                <span className="font-medium text-foreground">
                  {adminPreviewMode ? (
                    <>Creator fee tier ({feePercentLabel(feeTier.feeBps)}) — preview</>
                  ) : (
                    <>Partner fee tier ({feePercentLabel(feeTier.feeBps)})</>
                  )}
                </span>{' '}
                <span className="text-muted-foreground">
                  {adminPreviewMode
                    ? 'Allowlisted partners use 2%. Economics below are for this wallet only.'
                    : 'Applies to new raffles you host; see economics below.'}
                </span>
              </span>
            </li>
            <li className="flex gap-3 px-5 py-4 sm:px-6">
              {tenantId ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 text-sm leading-relaxed">
                <span className="font-medium text-foreground">Discord tenant</span>{' '}
                <span className="text-muted-foreground">
                  {tenantId ? 'Webhook id is configured for this wallet.' : 'Link a tenant id for Owl Vision Discord events.'}
                </span>
              </span>
            </li>
            <li className="flex gap-3 px-5 py-4 sm:px-6">
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 text-sm leading-relaxed">
                {raffles.length === 0 ? (
                  <span className="text-muted-foreground">
                    Main feed: create a raffle to choose public listing vs direct-link only (
                    <code className="rounded bg-muted/60 px-1 font-mono text-xs">list on platform</code>
                    ).
                  </span>
                ) : (
                  <>
                    <span className="font-medium text-foreground">Visibility</span>{' '}
                    <span className="text-muted-foreground">
                      {mainFeedListedCount} of {raffles.length} raffle{raffles.length === 1 ? '' : 's'} on the main{' '}
                      <span className="text-foreground/90">/raffles</span> feed
                      {discordOnlyCount > 0
                        ? `; ${discordOnlyCount} direct-link / Discord-only`
                        : ''}
                      .
                    </span>
                  </>
                )}
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <section aria-labelledby="economics-heading" className="mb-6">
        <h2 id="economics-heading" className="sr-only">
          Economics
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className={STAT_CARD}>
            <CardHeader className="pb-2 pt-5">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Fee tier
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-2 pb-5">
              <p className="text-2xl font-bold tracking-tight">
                {feePercentLabel(feeTier.feeBps)}{' '}
                <span className="text-base font-semibold text-muted-foreground">fee</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {adminPreviewMode
                  ? "This wallet's creator rate. Partner allowlist tier is typically 2%."
                  : 'Partner program rate on ticket revenue.'}
              </p>
              <details className="group mt-auto text-xs text-muted-foreground">
                <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground touch-manipulation min-h-[44px] sm:min-h-0 [&::-webkit-details-marker]:hidden">
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                  How fees apply
                </summary>
                <p className="mt-2 pb-1 leading-relaxed">
                  New raffles use funds escrow; platform fee and your net share settle when you claim after the draw.
                  Older raffles may use split-at-purchase. Use the Hosting tab on your main dashboard for live escrow and
                  claims.
                </p>
              </details>
            </CardContent>
          </Card>

          <Card className={STAT_CARD}>
            <CardHeader className="pb-2 pt-5">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Creator revenue
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-2 pb-5">
              <div className="flex items-start gap-2">
                <Coins className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold tabular-nums tracking-tight break-words">
                    {creatorRevenue > 0 ? currencyMapToJoinedLine(data.creatorRevenueByCurrency) : '—'}
                  </p>
                </div>
              </div>
              {creatorRevenue > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground">After platform fee (settled plus live estimate).</p>
                  {Object.keys(data.creatorLiveEarningsByCurrency).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Live:{' '}
                      <span className="font-medium tabular-nums text-foreground/90">
                        {currencyMapToJoinedLine(data.creatorLiveEarningsByCurrency)}
                      </span>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No earnings from hosted raffles yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className={STAT_CARD}>
            <CardHeader className="pb-2 pt-5">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Gross ticket sales
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col pb-5">
              <p className="text-2xl font-bold tabular-nums tracking-tight break-words">
                {Object.keys(data.creatorAllTimeGrossByCurrency).length > 0
                  ? currencyMapToJoinedLine(data.creatorAllTimeGrossByCurrency)
                  : '—'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirmed ticket volume (before platform fee).
              </p>
            </CardContent>
          </Card>

          <Card className={STAT_CARD}>
            <CardHeader className="pb-2 pt-5">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Live escrow
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-2 pb-5">
              {Object.keys(escrowGross).length > 0 ? (
                <>
                  <p className="text-sm font-medium tabular-nums">
                    Gross <span className="font-normal text-muted-foreground">·</span> fee{' '}
                    <span className="font-normal text-muted-foreground">·</span> net
                  </p>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    {Object.keys(escrowGross).map((cur) => {
                      const g = escrowGross[cur] ?? 0
                      const f = data.claimTrackerLiveFundsEscrowSales.feeByCurrency[cur] ?? 0
                      const n = data.claimTrackerLiveFundsEscrowSales.netByCurrency[cur] ?? 0
                      return (
                        <li key={cur} className="leading-relaxed tabular-nums">
                          <span className="font-medium text-foreground/90">{cur}</span>{' '}
                          {formatCurrencyAmount(cur, g)} gross · {formatCurrencyAmount(cur, f)} fee ·{' '}
                          <span className="text-foreground/90">{formatCurrencyAmount(cur, n)}</span> net
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No live escrow tracked for this wallet right now.</p>
              )}
              <p className="mt-auto pt-2 text-xs text-muted-foreground">
                Claim from{' '}
                <Link
                  href="/dashboard?tab=hosting"
                  className="font-medium text-primary underline-offset-2 hover:underline touch-manipulation"
                >
                  Hosting
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className={`${CARD_SURFACE} mb-8`}>
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Pipeline</CardTitle>
          <CardDescription>All raffles from this wallet, every visibility mode.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <p className="mb-4 text-sm tabular-nums text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{raffles.length}</span> hosted raffle
            {raffles.length === 1 ? '' : 's'}
          </p>
          {raffles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No raffles yet — create one from the usual flow.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'active' as const, label: 'Active / drawing / claims', hint: pipelineBuckets.active },
                { key: 'completed' as const, label: 'Completed', hint: pipelineBuckets.completed },
                { key: 'attention' as const, label: 'Needs attention', hint: pipelineBuckets.attention },
                { key: 'draft' as const, label: 'Draft', hint: pipelineBuckets.draft },
                { key: 'other' as const, label: 'Other', hint: pipelineBuckets.other },
              ]
                .filter((row) => row.hint > 0)
                .map((row) => (
                  <div
                    key={row.key}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-border/60 bg-muted/25 px-3 py-1.5 text-sm touch-manipulation"
                  >
                    <span className="max-w-[11rem] truncate text-muted-foreground sm:max-w-none">{row.label}</span>
                    <span className="font-semibold tabular-nums text-foreground">{row.hint}</span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <nav aria-label="Shortcuts" className="mb-8">
        <ul className="grid gap-2">
          {adminPreviewMode && (
            <li>
              <Link
                href="/admin"
                className={`${CARD_SURFACE} flex min-h-[52px] touch-manipulation items-center justify-between gap-3 p-4 transition-colors hover:border-primary/35 hover:bg-muted/20`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
                    <Shield className="h-5 w-5 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="font-medium">Site admin dashboard</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          )}
          <li>
            <Link
              href="/raffles?tab=partner-raffles"
              className={`${CARD_SURFACE} flex min-h-[52px] touch-manipulation items-center justify-between gap-3 p-4 transition-colors hover:border-primary/35 hover:bg-muted/20`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
                  <Radio className="h-5 w-5 text-muted-foreground" aria-hidden />
                </span>
                <span className="font-medium">Partner raffles (public)</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard"
              className={`${CARD_SURFACE} flex min-h-[52px] touch-manipulation items-center justify-between gap-3 p-4 transition-colors hover:border-primary/35 hover:bg-muted/20`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
                  <LayoutDashboard className="h-5 w-5 text-muted-foreground" aria-hidden />
                </span>
                <span className="min-w-0 font-medium leading-snug">Full dashboard</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        </ul>
      </nav>

      <Card className={`${CARD_SURFACE} mb-8`}>
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Discord tenant</CardTitle>
          <CardDescription>
            When linked to your allowlist row, ticket raffles can use your server webhooks. Copy for your org if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {tenantId ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <code className="min-h-[44px] flex-1 rounded-xl border border-border/50 bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed break-all">
                {tenantId}
              </code>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] shrink-0 touch-manipulation sm:w-auto"
                onClick={() => void copyTenant(tenantId)}
              >
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                <span className="ml-2">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          ) : adminPreviewMode ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              No tenant on this wallet row. Manage allowlisted creators in{' '}
              <Link href="/admin/partner-creators" className="font-medium text-primary underline-offset-2 hover:underline">
                partner creators
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Not linked yet. Ask the team to set a tenant in{' '}
              <Link href="/admin/partner-creators" className="font-medium text-primary underline-offset-2 hover:underline">
                partner creators
              </Link>{' '}
              or use Discord <code className="rounded bg-muted/60 px-1 font-mono text-xs">/owltopia-partner</code> after
              subscription.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className={CARD_SURFACE}>
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Your hosted raffles</CardTitle>
          <CardDescription>
            Public listing links. Same list as &quot;My raffles&quot; on your dashboard.
            {canExportEntrantCsv && <> CSV export: confirmed entrant wallets (partners and site admins).</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {raffles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No raffles from this wallet yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/50">
              {raffles.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <Link
                    href={`/raffles/${r.slug}`}
                    className="inline-flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-sm font-medium text-primary touch-manipulation underline-offset-4 hover:underline"
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">({r.status})</span>
                  </Link>
                  {canExportEntrantCsv && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] w-full shrink-0 touch-manipulation sm:w-auto"
                      disabled={exportingRaffleId === r.id}
                      onClick={() => void downloadEntrantsCsv(r)}
                    >
                      {exportingRaffleId === r.id ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <Download className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                      <span className="ml-2">Entrants CSV</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
