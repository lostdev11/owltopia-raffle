'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { LayoutDashboard, Ticket, Coins, TrendingUp, ExternalLink, Loader2, User } from 'lucide-react'
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
    try {
      const res = await fetch('/api/me/dashboard', { credentials: 'include' })
      if (res.status === 401) {
        setNeedsSignIn(true)
        setData(null)
        return
      }
      if (!res.ok) throw new Error('Failed to load dashboard')
      const json = await res.json()
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

  const { myRaffles, myEntries, creatorRevenue, creatorRevenueByCurrency, feeTier, wallet, displayName } = data

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
            Display name
          </CardTitle>
          <CardDescription>
            This name will appear in raffle participant lists instead of your wallet address. Leave blank to show your address.
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
            <p className="text-sm text-muted-foreground capitalize">{feeTier.reason}</p>
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
                    <button
                      type="button"
                      onClick={() => toggleRaffle(r.id)}
                      className="flex w-full items-center justify-between gap-4 py-2 text-left"
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
                        <Link
                          href={`/raffles/${r.slug}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
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
