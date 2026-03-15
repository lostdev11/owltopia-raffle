'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { LayoutDashboard, Ticket, Coins, TrendingUp, ExternalLink, Loader2, User, XCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'

type FeeTier = { feeBps: number; reason: string }
type Raffle = {
  id: string
  slug: string
  title: string
  status: string | null
  creator_payout_amount: number | null
  currency: string
  end_time: string
  prize_type?: string | null
  cancellation_requested_at?: string | null
}
type EntryWithRaffle = {
  entry: { id: string; ticket_quantity: number; amount_paid: number; currency: string; status: string; created_at: string }
  raffle: { id: string; slug: string; title: string; status: string | null; winner_wallet: string | null }
}

type DashboardData = {
  wallet: string
  displayName: string | null
  myRaffles: Raffle[]
  myEntries: EntryWithRaffle[]
  creatorRevenue: number
  creatorRevenueByCurrency: Record<string, number>
  feeTier: FeeTier
}

export default function DashboardPage() {
  const { publicKey, connected, signMessage } = useWallet()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [entriesFilter, setEntriesFilter] = useState<'all' | 'won'>('all')
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)
  const [openRaffleId, setOpenRaffleId] = useState<string | null>(null)
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [escrowLinkLoadingId, setEscrowLinkLoadingId] = useState<string | null>(null)
  const [requestCancelId, setRequestCancelId] = useState<string | null>(null)
  const [requestCancelError, setRequestCancelError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    if (!connected || !publicKey) {
      setData(null)
      setLoading(false)
      setNeedsSignIn(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    setNeedsSignIn(false)
    const walletAddr = publicKey.toBase58()
    try {
      const res = await fetch('/api/me/dashboard', {
        credentials: 'include',
        headers: { 'X-Connected-Wallet': walletAddr },
      })
      if (res.status === 401) {
        setNeedsSignIn(true)
        setData(null)
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof json?.error === 'string' ? json.error : 'Failed to load dashboard'
        setError(msg)
        return
      }
      if (json.wallet && json.wallet !== walletAddr) {
        setNeedsSignIn(true)
        setData(null)
        return
      }
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [connected, publicKey])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  // Sync display name input when dashboard data loads (must be unconditional for Rules of Hooks)
  useEffect(() => {
    if (data != null) {
      setDisplayNameInput(data.displayName ?? '')
    }
  }, [data?.displayName, data])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const walletAddr = publicKey.toBase58()
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
        credentials: 'include',
      })
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Failed to get sign-in nonce')
      }
      const { message } = (await nonceRes.json()) as { message: string }
      const messageBytes = new TextEncoder().encode(message)
      const signature = await signMessage(messageBytes)
      const signatureBase64 =
        typeof signature === 'string'
          ? btoa(signature)
          : btoa(String.fromCharCode(...new Uint8Array(signature)))

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: walletAddr,
          message,
          signature: signatureBase64,
        }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Sign-in verification failed')
      }

      await loadDashboard()
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, signMessage, loadDashboard])

  const openEscrowCheck = useCallback(async (raffleId: string) => {
    setEscrowLinkLoadingId(raffleId)
    try {
      const res = await fetch(`/api/raffles/${raffleId}/escrow-check-url`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && typeof (data as { url?: string }).url === 'string') {
        window.open((data as { url: string }).url, '_blank', 'noopener,noreferrer')
      } else {
        const msg = typeof (data as { error?: string }).error === 'string' ? (data as { error: string }).error : 'Could not open Solscan link.'
        alert(msg)
      }
    } finally {
      setEscrowLinkLoadingId(null)
    }
  }, [])

  if (!connected) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-4">My Dashboard</h1>
        <p className="text-muted-foreground mb-6">
          Connect your wallet to see your raffles, entries, and creator revenue.
        </p>
        <WalletConnectButton />
      </main>
    )
  }

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading your dashboard…
        </div>
      </main>
    )
  }

  if (needsSignIn) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-4">My Dashboard</h1>
        <p className="text-muted-foreground mb-6">
          Sign in with your wallet to see your raffles, entries, and revenue. This is a one-time message signature (no transaction or fee).
        </p>
        {signInError && <p className="text-destructive mb-4">{signInError}</p>}
        <Button onClick={handleSignIn} disabled={signingIn || !signMessage}>
          {signingIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Signing in…
            </>
          ) : (
            'Sign in with wallet'
          )}
        </Button>
        {!signMessage && (
          <p className="text-sm text-muted-foreground mt-2">
            Your connected wallet does not support message signing. Try another wallet.
          </p>
        )}
      </main>
    )
  }

  if (error) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-4">My Dashboard</h1>
        <p className="text-destructive">{error}</p>
      </main>
    )
  }

  if (!data) {
    return null
  }

  // Defensive: avoid crashes if API returns unexpected shape (e.g. partial/cached response)
  const myRaffles = Array.isArray(data.myRaffles) ? data.myRaffles : []
  const myEntries = Array.isArray(data.myEntries) ? data.myEntries : []
  const creatorRevenue = typeof data.creatorRevenue === 'number' ? data.creatorRevenue : 0
  const creatorRevenueByCurrency =
    data.creatorRevenueByCurrency && typeof data.creatorRevenueByCurrency === 'object'
      ? data.creatorRevenueByCurrency
      : {}
  const feeTier =
    data.feeTier && typeof data.feeTier.feeBps === 'number' && typeof data.feeTier.reason === 'string'
      ? data.feeTier
      : { feeBps: 600, reason: 'standard' as const }
  const wallet = typeof data.wallet === 'string' ? data.wallet : ''
  const displayName = data.displayName != null ? String(data.displayName) : null

  const filteredEntries =
    entriesFilter === 'won'
      ? myEntries.filter(({ raffle }) => raffle.winner_wallet === wallet)
      : myEntries

  const toggleEntry = (id: string) => {
    setOpenEntryId((prev) => (prev === id ? null : id))
  }

  const toggleRaffle = (id: string) => {
    setOpenRaffleId((prev) => (prev === id ? null : id))
  }

  const handleRequestCancellation = useCallback(
    async (raffleId: string) => {
      setRequestCancelError(null)
      setRequestCancelId(raffleId)
      try {
        const res = await fetch(`/api/raffles/${raffleId}/request-cancellation`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setRequestCancelError((json as { error?: string }).error ?? 'Failed to request cancellation')
          return
        }
        loadDashboard()
      } finally {
        setRequestCancelId(null)
      }
    },
    [loadDashboard]
  )

  const handleSaveDisplayName = async () => {
    setDisplayNameError(null)
    const name = displayNameInput.trim().slice(0, 32)
    if (!name) {
      setDisplayNameError('Enter a display name (1–32 characters)')
      return
    }
    setDisplayNameSaving(true)
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName: name }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDisplayNameError((json as { error?: string }).error || 'Failed to save')
        return
      }
      setData((prev) => (prev ? { ...prev, displayName: name } : null))
    } finally {
      setDisplayNameSaving(false)
    }
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex items-center gap-2 mb-8">
        <LayoutDashboard className="h-8 w-8" />
        <h1 className="text-2xl font-bold">My Dashboard</h1>
      </div>

      <Card className="mb-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <User className="h-4 w-4" />
            Display name for this wallet
          </CardTitle>
          <CardDescription>
            Each wallet has its own display name. This name will appear in raffle participant lists for this wallet. Leave blank to show the wallet address.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="e.g. Crazyfox"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value.slice(0, 32))}
            maxLength={32}
            className="max-w-xs"
          />
          <Button onClick={handleSaveDisplayName} disabled={displayNameSaving}>
            {displayNameSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </CardContent>
        {displayNameError && (
          <p className="text-sm text-destructive px-6 pb-4">{displayNameError}</p>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fee tier</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {feeTier.feeBps === 300 ? '3%' : feeTier.feeBps === 600 ? '6%' : `${(feeTier.feeBps / 100).toFixed(1)}%`} platform fee
            </p>
            <p className="text-sm text-muted-foreground">
              {feeTier.reason === 'holder' ? 'Owltopia (Owl NFT) holder' : 'Non-holder'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Fee is taken from each ticket sale at purchase time.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Creator revenue (earned)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {creatorRevenue > 0
                ? Object.entries(creatorRevenueByCurrency)
                    .map(([cur, amt]) => `${amt.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
                    .join(' + ') || '—'
                : '—'}
            </p>
            {creatorRevenue === 0 && (
              <p className="text-sm text-muted-foreground">From completed raffles you created</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              My raffles
            </CardTitle>
            <CardDescription>Raffles you created ({myRaffles.length})</CardDescription>
          </div>
          <Button asChild className="shrink-0">
            <Link href="/admin/raffles/new">Create raffle</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {myRaffles.length === 0 ? (
            <p className="text-muted-foreground">You haven’t created any raffles yet.</p>
          ) : (
            <ul className="space-y-2">
              {myRaffles.slice(0, 20).map((r) => {
                const isOpen = openRaffleId === r.id
                const endTime = new Date(r.end_time)
                return (
                  <li
                    key={r.id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleRaffle(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleRaffle(r.id)
                        }
                      }}
                      className="flex w-full cursor-pointer items-center justify-between gap-4 py-2 text-left"
                    >
                      <span className="flex min-w-0 flex-col">
                        <Link
                          href={`/raffles/${r.slug}`}
                          className="font-medium hover:underline truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          Ends {endTime.toLocaleString()}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-sm text-muted-foreground">
                        <span className="capitalize">{r.status ?? 'draft'}</span>
                        {r.creator_payout_amount != null && r.status === 'completed' && (
                          <span>
                            {Number(r.creator_payout_amount).toFixed(r.currency === 'USDC' ? 2 : 4)} {r.currency}
                          </span>
                        )}
                        {r.prize_type === 'nft' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEscrowCheck(r.id)
                            }}
                            disabled={escrowLinkLoadingId === r.id}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                            title="View NFT in escrow on Solscan"
                          >
                            {escrowLinkLoadingId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <ExternalLink className="h-4 w-4" />
                                <span className="hidden sm:inline">Solscan</span>
                              </>
                            )}
                          </button>
                        )}
                        <Link
                          href={`/raffles/${r.slug}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </Link>
                      </span>
                    </div>
                    <div
                      className={`overflow-hidden transition-all duration-300 ${
                        isOpen ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="pb-3 pl-1 pr-1 text-sm text-muted-foreground space-y-1">
                        {requestCancelError && (
                          <p className="text-destructive text-xs">{requestCancelError}</p>
                        )}
                        <p>
                          <span className="font-medium text-foreground">Payout:</span>{' '}
                          {r.creator_payout_amount != null && r.status === 'completed'
                            ? `${Number(r.creator_payout_amount).toFixed(
                                r.currency === 'USDC' ? 2 : 4
                              )} ${r.currency}`
                            : 'Not settled yet'}
                        </p>
                        <p>
                          <span className="font-medium text-foreground">Status:</span>{' '}
                          <span className="capitalize">{r.status ?? 'draft'}</span>
                        </p>
                        {(r.status === 'live' || r.status === 'ready_to_draw') && !r.cancellation_requested_at && (
                          <p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-amber-600 border-amber-500/50 hover:bg-amber-500/10"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRequestCancellation(r.id)
                              }}
                              disabled={requestCancelId === r.id}
                            >
                              {requestCancelId === r.id ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                  Requesting…
                                </>
                              ) : (
                                <>
                                  <XCircle className="h-3.5 w-3.5 mr-1" />
                                  Request cancellation
                                </>
                              )}
                            </Button>
                            <span className="block text-xs mt-1 text-muted-foreground">
                              Admin will review in Owl Vision. Ticket buyers get refunds in all cases. Within 24h: no fee to you. After 24h: you (host) are charged a cancellation fee.
                            </span>
                          </p>
                        )}
                        {r.cancellation_requested_at && r.status !== 'cancelled' && (
                          <p className="text-amber-600 dark:text-amber-400 text-xs">
                            Cancellation requested. Waiting for admin approval in Owl Vision.
                          </p>
                        )}
                        {r.prize_type === 'nft' && (
                          <p>
                            <button
                              type="button"
                              onClick={() => openEscrowCheck(r.id)}
                              disabled={escrowLinkLoadingId === r.id}
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              {escrowLinkLoadingId === r.id ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Opening…
                                </>
                              ) : (
                                <>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  View NFT in escrow (Solscan)
                                </>
                              )}
                            </button>
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            )}
            {myRaffles.length > 20 && (
            <p className="text-sm text-muted-foreground mt-2">Showing latest 20 of {myRaffles.length}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5" />
              My entries
            </CardTitle>
            <CardDescription>Raffles you entered ({myEntries.length})</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Show</span>
            <select
              value={entriesFilter}
              onChange={(e) => setEntriesFilter(e.target.value as 'all' | 'won')}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="all">All entries</option>
              <option value="won">Only winning entries</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredEntries.length === 0 ? (
            <p className="text-muted-foreground">
              {myEntries.length === 0
                ? 'You haven’t entered any raffles yet.'
                : 'No entries match this filter.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {filteredEntries.slice(0, 20).map(({ entry, raffle }) => {
                const isOpen = openEntryId === entry.id
                const createdAt = new Date(entry.created_at)
                return (
                  <li
                    key={entry.id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => toggleEntry(entry.id)}
                      className="flex w-full items-center justify-between gap-4 py-2 text-left"
                    >
                      <span className="flex min-w-0 flex-col">
                        <Link
                          href={`/raffles/${raffle.slug}`}
                          className="font-medium hover:underline truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {raffle.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {createdAt.toLocaleString()}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-sm text-muted-foreground">
                        {entry.ticket_quantity} ticket
                        {entry.ticket_quantity !== 1 ? 's' : ''}
                        {raffle.winner_wallet === wallet && (
                          <span className="text-green-600">· You won!</span>
                        )}
                        <Link
                          href={`/raffles/${raffle.slug}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-4 w-4 hover:text-foreground" />
                        </Link>
                      </span>
                    </button>
                    <div
                      className={`overflow-hidden transition-all duration-300 ${
                        isOpen ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="pb-3 pl-1 pr-1 text-sm text-muted-foreground space-y-1">
                        <p>
                          <span className="font-medium text-foreground">Amount paid:</span>{' '}
                          {entry.amount_paid.toFixed(entry.currency === 'USDC' ? 2 : 4)}{' '}
                          {entry.currency}
                        </p>
                        <p className="capitalize">
                          <span className="font-medium text-foreground">Entry status:</span>{' '}
                          {entry.status.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {filteredEntries.length > 20 && (
            <p className="text-sm text-muted-foreground mt-2">
              Showing latest 20 of {filteredEntries.length}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
