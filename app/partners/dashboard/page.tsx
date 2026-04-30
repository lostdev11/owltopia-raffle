'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  Loader2,
  ArrowLeft,
  Users,
  LayoutDashboard,
  ExternalLink,
  Radio,
  Copy,
  Check,
  CheckCircle2,
  Circle,
  Coins,
  ChevronDown,
  AlertTriangle,
  Shield,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { isMobileDevice } from '@/lib/utils'
import { PLATFORM_NAME } from '@/lib/site-config'

const MOBILE_401_RETRY_DELAY_MS = 500

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

  if (!connected || !publicKey) {
    return (
      <div className="container max-w-lg mx-auto py-10 sm:py-12 px-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px] mb-4">
          <Link href="/raffles?tab=partner-raffles" className="inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Partner raffles
          </Link>
        </Button>
        <h1 className="text-2xl font-bold mb-2">Partner host hub</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Connect the wallet that is allowlisted in the {PLATFORM_NAME} partner program to see your public listing scope,
          Discord link id, and shortcuts. Site admins can also open this page with any connected wallet to preview the hub
          and their own creator stats. Claims and settlement stay on the main user dashboard.
        </p>
        <div className="touch-manipulation min-h-[44px] [&_button]:min-h-[44px] [&_button]:w-full sm:[&_button]:w-auto">
          <WalletConnectButton />
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="container max-w-2xl mx-auto py-16 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  if (needsSignIn) {
    return (
      <div className="container max-w-lg mx-auto py-10 px-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <p className="text-muted-foreground mb-4">Sign the message in your wallet to use the partner hub (same as the main dashboard).</p>
        <Button type="button" onClick={() => void load(false)} className="min-h-[44px] touch-manipulation w-full sm:w-auto">
          Retry
        </Button>
        <div className="mt-4">
          <Button asChild variant="outline" className="min-h-[44px] w-full sm:w-auto touch-manipulation">
            <Link href="/dashboard">Open full dashboard</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container max-w-lg mx-auto py-10 px-4">
        <p className="text-destructive text-sm mb-4">{error}</p>
        <Button type="button" onClick={() => void load(false)} className="min-h-[44px]">
          Try again
        </Button>
      </div>
    )
  }

  if (data && !canAccessPartnerHub) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px] mb-4">
          <Link href="/raffles" className="inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Raffles
          </Link>
        </Button>
        <h1 className="text-2xl font-bold mb-2">Partner host hub</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Connected <span className="font-mono text-xs">{wallet}</span> is not on the partner program allowlist yet, or
          the row is inactive.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Apply to the program</CardTitle>
            <CardDescription>We review project fit, fee tier, and any Discord or prize setup.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="min-h-[44px] touch-manipulation w-full sm:w-auto">
              <Link href="/partner-program">Partner program</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-[44px] touch-manipulation w-full sm:w-auto">
              <Link href="/dashboard">Main dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const tenantId = data?.partnerDiscordTenantId?.trim() || null

  if (!data) {
    return (
      <div className="container max-w-2xl mx-auto py-16 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  const discordOnlyCount = raffles.length - mainFeedListedCount
  const feeTier = data.feeTier
  const creatorRevenue = data.creatorRevenue
  const escrowGross = data.claimTrackerLiveFundsEscrowSales.grossByCurrency

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-7 w-7 text-violet-400 shrink-0" aria-hidden />
            Partner host hub
          </h1>
          <p className="text-sm text-muted-foreground font-mono mt-1 break-all">{wallet}</p>
          {adminPreviewMode && (
            <p className="mt-3 text-sm rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground">
              <span className="font-medium text-foreground">Admin preview</span> — this hub is unlocked for site admins.
              Figures below follow the wallet you have connected ({PLATFORM_NAME} session), which is not on the partner
              allowlist for a 2% tier.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] touch-manipulation shrink-0 w-full sm:w-auto"
          onClick={() => void load(false)}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
        </Button>
      </div>

      {adminPreviewMode ? (
        <p className="text-sm text-muted-foreground mb-6">
          Same layout community partners see. Tenant id and economics below match your signed-in admin wallet. Compare
          with the public{' '}
          <Link href="/raffles?tab=partner-raffles" className="text-primary underline-offset-2 hover:underline">
            partner raffles
          </Link>{' '}
          tab. Money movement and claims stay on your main dashboard and admin tools.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground mb-6">
          Your raffles in the <span className="font-medium text-foreground/90">Main</span> feed are separate from the
          public{' '}
          <Link href="/raffles?tab=partner-raffles" className="text-primary underline-offset-2 hover:underline">
            partner raffles
          </Link>{' '}
          section. Set your Discord webhooks in your server; full money flows and claims stay in the main dashboard.
        </p>
      )}

      {data.creatorRefundRaffles.length > 0 && (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3 min-w-0">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  Refund action needed on {data.creatorRefundRaffles.length} raffle
                  {data.creatorRefundRaffles.length === 1 ? '' : 's'}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Hosted tab on the full dashboard handles buyer refunds and legacy flows.
                </p>
              </div>
            </div>
            <Button asChild className="min-h-[44px] touch-manipulation shrink-0 w-full sm:w-auto">
              <Link href="/dashboard?tab=hosting">Open dashboard — Hosting</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6 rounded-xl border-border/60 bg-card/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Partner setup checklist</CardTitle>
          <CardDescription>Quick view of program links; detail lives on the cards below.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            <li className="flex gap-3 min-w-0">
              {adminPreviewMode ? (
                <Circle className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
              ) : (
                <CheckCircle2
                  className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400 mt-0.5"
                  aria-hidden
                />
              )}
              <span className="text-sm">
                <span className="font-medium text-foreground">
                  {adminPreviewMode ? (
                    <>Creator fee tier ({feePercentLabel(feeTier.feeBps)}) — admin preview.</>
                  ) : (
                    <>Partner fee tier ({feePercentLabel(feeTier.feeBps)}).</>
                  )}
                </span>{' '}
                <span className="text-muted-foreground">
                  {adminPreviewMode
                    ? 'Allowlisted partners use 2%. Economics below are for this wallet only.'
                    : 'Applies to new raffles you host; see economics below for payouts.'}
                </span>
              </span>
            </li>
            <li className="flex gap-3 min-w-0">
              {tenantId ? (
                <CheckCircle2
                  className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400 mt-0.5"
                  aria-hidden
                />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
              )}
              <span className="text-sm">
                <span className="font-medium text-foreground">Discord partner tenant linked.</span>{' '}
                <span className="text-muted-foreground">
                  {tenantId ? 'Webhook id is configured for this wallet.' : 'Link a tenant id for Owl Vision Discord events.'}
                </span>
              </span>
            </li>
            <li className="flex gap-3 min-w-0">
              {raffles.length === 0 ? (
                <>
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
                  <span className="text-sm text-muted-foreground">
                    Main feed visibility: create a raffle to choose public main listing vs direct-link only (
                    <code className="text-xs font-mono bg-muted/50 rounded px-1">list on platform</code>
                    ).
                  </span>
                </>
              ) : (
                <>
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">Main vs direct-only.</span>{' '}
                    <span className="text-muted-foreground">
                      {mainFeedListedCount} of {raffles.length} hosted raffle{raffles.length === 1 ? '' : 's'} use the{' '}
                      public main <span className="text-foreground/90">/raffles</span> feed
                      {discordOnlyCount > 0
                        ? `; ${discordOnlyCount} ${discordOnlyCount === 1 ? 'is' : 'are'} direct-link / Discord-style only`
                        : ''}
                      .
                    </span>
                  </span>
                </>
              )}
            </li>
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fee tier
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-bold tracking-tight">
              {feePercentLabel(feeTier.feeBps)} <span className="text-base font-semibold text-muted-foreground">fee</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {adminPreviewMode
                ? "This wallet's creator rate. Partner allowlist tier is typically 2%."
                : 'Partner program rate on ticket revenue.'}
            </p>
            <details className="group text-xs text-muted-foreground">
              <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground touch-manipulation min-h-[44px] sm:min-h-0 [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden
                />
                How fees apply
              </summary>
              <p className="mt-2 leading-relaxed pl-1 pb-2">
                New raffles use funds escrow; platform fee and your net share settle when you claim after the draw. Older
                raffles may use split-at-purchase. Use the Hosting tab on your main dashboard for live escrow and claims.
              </p>
            </details>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Creator revenue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-start gap-2">
              <Coins className="h-5 w-5 shrink-0 text-muted-foreground mt-1" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-bold tabular-nums tracking-tight break-words">
                  {creatorRevenue > 0
                    ? currencyMapToJoinedLine(data.creatorRevenueByCurrency)
                    : '—'}
                </p>
              </div>
            </div>
            {creatorRevenue > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">After platform fee (settled plus live estimate).</p>
                {Object.keys(data.creatorLiveEarningsByCurrency).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Live:{' '}
                    <span className="tabular-nums font-medium text-foreground/90">
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

        <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Gross ticket sales
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-bold tabular-nums tracking-tight break-words">
              {Object.keys(data.creatorAllTimeGrossByCurrency).length > 0
                ? currencyMapToJoinedLine(data.creatorAllTimeGrossByCurrency)
                : '—'}
            </p>
            <p className="text-sm text-muted-foreground">
              Confirmed ticket volume across your hosted raffles (before platform fee).
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 bg-card/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Live escrow (tracked)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(escrowGross).length > 0 ? (
              <>
                <p className="text-sm tabular-nums font-medium break-words">
                  Gross{' '}
                  <span className="text-muted-foreground font-normal">·</span> fee{' '}
                  <span className="text-muted-foreground font-normal">·</span> your net (by currency)
                </p>
                <ul className="text-xs text-muted-foreground space-y-2">
                  {Object.keys(escrowGross).map((cur) => {
                    const g = escrowGross[cur] ?? 0
                    const f = data.claimTrackerLiveFundsEscrowSales.feeByCurrency[cur] ?? 0
                    const n = data.claimTrackerLiveFundsEscrowSales.netByCurrency[cur] ?? 0
                    return (
                      <li key={cur} className="tabular-nums leading-relaxed">
                        <span className="font-medium text-foreground/90">{cur}</span>{' '}
                        {formatCurrencyAmount(cur, g)} gross · {formatCurrencyAmount(cur, f)} fee ·{' '}
                        <span className="text-foreground/90">{formatCurrencyAmount(cur, n)}</span> net
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No live escrow sales tracked under this wallet right now.</p>
            )}
            <p className="text-xs text-muted-foreground pt-1">
              Claim from the Hosting section on{' '}
              <Link
                href="/dashboard?tab=hosting"
                className="text-primary underline-offset-2 hover:underline touch-manipulation"
              >
                your dashboard
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8 rounded-xl border-border/60 bg-card/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            Pipeline overview
          </CardTitle>
          <CardDescription>Counts include every raffle created from this wallet (all visibility modes).</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3 tabular-nums">
            Total hosted raffle{raffles.length === 1 ? '' : 's'}: {raffles.length}
          </p>
          {raffles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No raffles yet — create one from Create or your usual flow.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 text-sm">
              {[
                { key: 'active' as const, label: 'Active / drawing / pending claims', hint: pipelineBuckets.active },
                { key: 'completed' as const, label: 'Completed', hint: pipelineBuckets.completed },
                { key: 'attention' as const, label: 'Needs attention (mins, refunds, cancelled)', hint: pipelineBuckets.attention },
                { key: 'draft' as const, label: 'Draft', hint: pipelineBuckets.draft },
                { key: 'other' as const, label: 'Other', hint: pipelineBuckets.other },
              ]
                .filter((row) => row.hint > 0)
                .map((row) => (
                  <li key={row.key} className="rounded-md border border-border/60 px-3 py-2 flex justify-between gap-2 tabular-nums">
                    <span className="text-muted-foreground min-w-0">{row.label}</span>
                    <span className="font-semibold shrink-0">{row.hint}</span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 mb-8">
        {adminPreviewMode && (
          <Link href="/admin" className="block">
            <Card className="transition-colors hover:border-primary/30 touch-manipulation min-h-[44px]">
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Shield className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium truncate">Site admin dashboard</span>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        )}
        <Link href="/raffles?tab=partner-raffles" className="block">
          <Card className="transition-colors hover:border-primary/30 touch-manipulation min-h-[44px]">
            <CardContent className="p-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <Radio className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="font-medium truncate">View partner raffles (public)</span>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard" className="block">
          <Card className="transition-colors hover:border-primary/30 touch-manipulation min-h-[44px]">
            <CardContent className="p-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <LayoutDashboard className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="font-medium truncate">Full user dashboard (claims, entries, raffles)</span>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Discord partner tenant</CardTitle>
          <CardDescription>
            If Owl Vision links this id to your allowlist row, new ticket raffles you host can use your server webhooks
            (created + winner; claims on the user dashboard). Copy for your org or Supabase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tenantId ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="text-xs break-all font-mono bg-muted/50 rounded p-2 flex-1 min-w-0">{tenantId}</code>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] touch-manipulation shrink-0 w-full sm:w-auto"
                onClick={() => void copyTenant(tenantId)}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-2">Copy</span>
              </Button>
            </div>
          ) : adminPreviewMode ? (
            <p className="text-sm text-muted-foreground">
              No Discord tenant linked for this wallet row. Manage allowlisted creators in{' '}
              <Link href="/admin/partner-creators" className="text-primary underline-offset-2 hover:underline">
                partner creators
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not linked yet. Ask the team to set a tenant on your row in{' '}
              <Link href="/admin/partner-creators" className="text-primary underline-offset-2 hover:underline">
                partner creators
              </Link>
              (full admin) or use Discord{' '}
              <code className="text-xs font-mono">/owltopia-partner</code> after subscription.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your hosted raffles</CardTitle>
          <CardDescription>Same data as &quot;My raffles&quot; on the dashboard; links go to the public listing.</CardDescription>
        </CardHeader>
        <CardContent>
          {raffles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No raffles created from this wallet yet.</p>
          ) : (
            <ul className="space-y-2">
              {raffles.slice(0, 20).map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/raffles/${r.slug}`}
                    className="text-sm text-primary hover:underline touch-manipulation min-h-[44px] inline-flex items-center"
                  >
                    {r.title}
                    <span className="ml-2 text-xs text-muted-foreground font-mono">({r.status})</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
