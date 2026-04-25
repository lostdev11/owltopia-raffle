'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Loader2, ArrowLeft, Users, LayoutDashboard, ExternalLink, Radio, Copy, Check } from 'lucide-react'
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
}

type DashboardPayload = {
  feeTier: { reason: string; feeBps: number }
  partnerDiscordTenantId?: string | null
  myRaffles: DashboardRaffle[] | null
  wallet: string
}

/**
 * Host-facing hub for partner program wallets: public partner listings, full dashboard, Discord tenant id.
 * Anyone can open the URL; content requires connect + sign-in and partner allowlist.
 */
export default function PartnerHostDashboardPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [loading, setLoading] = useState(false)
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
      setData({
        wallet: String(json.wallet ?? addr),
        feeTier: { reason: String(feeTier?.reason ?? 'standard'), feeBps: Number(feeTier?.feeBps ?? 0) },
        partnerDiscordTenantId: (json.partnerDiscordTenantId as string | null) ?? null,
        myRaffles: Array.isArray(json.myRaffles) ? (json.myRaffles as DashboardRaffle[]) : [],
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
          Discord link id, and shortcuts. Claims and settlement stay on the main user dashboard.
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

  if (!isPartner) {
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

  const raffles = data?.myRaffles ?? []
  const tenantId = data?.partnerDiscordTenantId?.trim() || null

  return (
    <div className="container max-w-2xl mx-auto py-8 px-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-7 w-7 text-violet-400 shrink-0" aria-hidden />
            Partner host hub
          </h1>
          <p className="text-sm text-muted-foreground font-mono mt-1 break-all">{wallet}</p>
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

      <p className="text-sm text-muted-foreground mb-6">
        Your raffles in the <span className="font-medium text-foreground/90">Main</span> feed are separate from the
        public{' '}
        <Link href="/raffles?tab=partner-raffles" className="text-primary underline-offset-2 hover:underline">
          partner raffles
        </Link>{' '}
        section. Set your Discord webhooks in your server; full money flows and claims stay in the main dashboard.
      </p>

      <div className="grid gap-4 mb-8">
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
          <CardDescription>Same data as "My raffles" on the dashboard; links go to the public listing.</CardDescription>
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
