'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Bird, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import type { PartnerNestApplicationRow } from '@/lib/db/partner-nest-applications'

const TRIAGE = ['new', 'contacted'] as const

export default function AdminPartnerNestApplicationsPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [rows, setRows] = useState<PartnerNestApplicationRow[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        setCachedAdmin(addr, admin, admin && data?.role ? data.role : null)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    try {
      const res = await fetch('/api/admin/partner-nest-applications', {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setListError(typeof json?.error === 'string' ? json.error : 'Failed to load')
        return
      }
      setRows(Array.isArray(json.applications) ? json.applications : [])
    } catch {
      setListError('Failed to load')
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchList()
  }, [isAdmin, fetchList])

  const patch = async (
    id: number,
    body: { approve?: boolean; reward_mode?: string; status?: string; rejection_reason?: string }
  ) => {
    setSavingId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/partner-nest-applications/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(typeof json?.error === 'string' ? json.error : 'Action failed')
        return
      }
      await fetchList()
    } finally {
      setSavingId(null)
    }
  }

  if (!connected) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 text-center">
        <p className="text-muted-foreground mb-6">Connect a full-admin wallet.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (loading || isAdmin === null) {
    return (
      <div className="container mx-auto py-12 px-4 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 text-center">
        <p className="text-muted-foreground mb-6">Full Owl Vision access is required.</p>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link href="/admin">Back</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4 space-y-6">
      <Button asChild variant="ghost" size="sm" className="min-h-[44px] touch-manipulation">
        <Link href="/admin">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Owl Vision
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 flex items-center gap-2">
          <Bird className="h-7 w-7 text-emerald-500" aria-hidden />
          Partner Nesting requests
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Partners submit a collection address and optional reward SPL mint from their hub. Approve creates the nest
          perch. Prefer <strong className="text-foreground">Approve as OWL</strong> for live payouts today;{' '}
          <strong className="text-foreground">Approve with partner token</strong> stores their mint on the pool.
          After approve, the partner funds rewards from{' '}
          <Link href="/partners/dashboard" className="text-primary underline-offset-4 hover:underline">
            /partners/dashboard
          </Link>{' '}
          so nesters can claim.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-[40px]">
            <Link href="/admin/partner-nesting">Manual Partner Nesting</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="min-h-[40px]">
            <Link href="/admin/partner-creators">Partner creators</Link>
          </Button>
        </div>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      {listError ? <p className="text-sm text-destructive">{listError}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue</CardTitle>
          <CardDescription>
            {loadingList ? 'Loading…' : `${rows.length} request${rows.length === 1 ? '' : 's'}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList && rows.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Nesting requests yet.</p>
          ) : (
            <ul className="space-y-5 divide-y divide-border/60">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2 pt-5 first:pt-0">
                  <p className="text-sm text-muted-foreground">
                    #{row.id} · {new Date(row.created_at).toLocaleString()} · {row.status}
                  </p>
                  <p className="font-medium">{row.pool_name || 'Untitled nest'}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{row.creator_wallet}</p>
                  <p className="break-all font-mono text-xs">
                    Collection: {row.collection_key}
                  </p>
                  <p className="text-sm">
                    Requested rewards:{' '}
                    {row.reward_mode_requested === 'partner_token' ? (
                      <>
                        <span className="font-medium">{row.reward_token_symbol}</span>{' '}
                        <span className="break-all font-mono text-xs">({row.reward_mint})</span>
                        {row.reward_decimals != null ? ` · ${row.reward_decimals} decimals` : ''}
                        {' · '}
                        {row.reward_rate}/day
                      </>
                    ) : (
                      <>OWL (platform) · {row.reward_rate}/day</>
                    )}
                  </p>
                  {row.notes ? <p className="text-sm text-muted-foreground">{row.notes}</p> : null}
                  {row.rejection_reason ? (
                    <p className="text-sm text-destructive">{row.rejection_reason}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-[44px] touch-manipulation"
                      disabled={savingId === row.id || row.status === 'closed'}
                      onClick={() => void patch(row.id, { approve: true, reward_mode: 'platform_owl' })}
                    >
                      {savingId === row.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Approve as OWL
                    </Button>
                    {row.reward_mode_requested === 'partner_token' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="min-h-[44px] touch-manipulation"
                        disabled={savingId === row.id || row.status === 'closed'}
                        onClick={() => void patch(row.id, { approve: true, reward_mode: 'partner_token' })}
                      >
                        Approve with partner token
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="min-h-[44px] touch-manipulation"
                      disabled={savingId === row.id || row.status === 'closed'}
                      onClick={() =>
                        void patch(row.id, {
                          status: 'closed',
                          rejection_reason: 'Rejected by admin',
                        })
                      }
                    >
                      Reject
                    </Button>
                    {TRIAGE.map((status) => (
                      <Button
                        key={status}
                        type="button"
                        size="sm"
                        variant={row.status === status ? 'default' : 'outline'}
                        className="min-h-[40px] touch-manipulation"
                        disabled={savingId === row.id}
                        onClick={() => void patch(row.id, { status })}
                      >
                        {status}
                      </Button>
                    ))}
                    {row.approved_pool_id ? (
                      <Button asChild size="sm" variant="outline" className="min-h-[40px]">
                        <Link href="/admin/partner-nesting">View partner pools</Link>
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
