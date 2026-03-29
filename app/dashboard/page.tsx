'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import {
  LayoutDashboard,
  Ticket,
  Coins,
  TrendingUp,
  ExternalLink,
  Loader2,
  User,
  XCircle,
  Check,
  Gift,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { isMobileDevice } from '@/lib/utils'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'

type FeeTier = { feeBps: number; reason: string }
type Raffle = {
  id: string
  slug: string
  title: string
  status: string | null
  creator_payout_amount: number | null
  platform_fee_amount?: number | null
  currency: string
  end_time: string
  prize_type?: string | null
  cancellation_requested_at?: string | null
  ticket_payments_to_funds_escrow?: boolean | null
  creator_claimed_at?: string | null
  creator_claim_tx?: string | null
  settled_at?: string | null
}
type EntryWithRaffle = {
  entry: {
    id: string
    ticket_quantity: number
    amount_paid: number
    currency: string
    status: string
    created_at: string
    refunded_at?: string | null
  }
  raffle: {
    id: string
    slug: string
    title: string
    end_time: string
    status: string | null
    winner_wallet: string | null
    ticket_payments_to_funds_escrow?: boolean | null
    prize_type?: string | null
    nft_mint_address?: string | null
    nft_transfer_transaction?: string | null
    prize_deposited_at?: string | null
    prize_returned_at?: string | null
    prize_standard?: string | null
  }
}

function raffleEndedOrCompleted(raffle: { end_time: string; status: string | null }): boolean {
  if (raffle.status === 'completed') return true
  const endMs = new Date(raffle.end_time).getTime()
  return !Number.isNaN(endMs) && endMs <= Date.now()
}

/** Matches server rules in POST /api/raffles/[id]/claim-prize */
function canClaimNftPrize(raffle: EntryWithRaffle['raffle'], wallet: string): boolean {
  const w = wallet.trim()
  if (!w || !raffle.winner_wallet?.trim() || raffle.winner_wallet.trim() !== w) return false
  if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address?.trim()) return false
  if (!raffle.prize_deposited_at) return false
  if (raffle.prize_returned_at) return false
  if (raffle.nft_transfer_transaction?.trim()) return false
  if (!raffleEndedOrCompleted(raffle)) return false
  return true
}

function solscanTxUrl(signature: string): string {
  const dev = /devnet/i.test(resolvePublicSolanaRpcUrl())
  return `https://solscan.io/tx/${encodeURIComponent(signature)}${dev ? '?cluster=devnet' : ''}`
}

type DashboardData = {
  wallet: string
  displayName: string | null
  myRaffles: Raffle[]
  myEntries: EntryWithRaffle[]
  creatorRevenue: number
  creatorRevenueByCurrency: Record<string, number>
  creatorLiveEarningsByCurrency?: Record<string, number>
  creatorAllTimeGrossByCurrency?: Record<string, number>
  feeTier: FeeTier
}

type NftWinnerDashboardRow = {
  raffle: EntryWithRaffle['raffle']
  prizeState: 'claimable' | 'claimed' | 'waiting' | 'returned'
  claimedTx: string | null
}

// On mobile, wait for wallet to stabilize after nav (e.g. redirect return) before calling dashboard API.
const MOBILE_WALLET_STABILIZE_MS = 450
// On mobile, retry once after 401 (session not ready yet after wallet connect).
const MOBILE_401_RETRY_DELAY_MS = 800

export default function DashboardPage() {
  const { publicKey, connected, signMessage } = useWallet()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [entriesFilter, setEntriesFilter] = useState<'all' | 'won'>('all')
  const [openRaffleId, setOpenRaffleId] = useState<string | null>(null)
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSaved, setDisplayNameSaved] = useState(false)
  const [escrowLinkLoadingId, setEscrowLinkLoadingId] = useState<string | null>(null)
  const [claimProceedsLoadingId, setClaimProceedsLoadingId] = useState<string | null>(null)
  const [claimPrizeLoadingId, setClaimPrizeLoadingId] = useState<string | null>(null)
  const [claimRefundLoadingEntryId, setClaimRefundLoadingEntryId] = useState<string | null>(null)
  const [claimActionError, setClaimActionError] = useState<string | null>(null)
  const [requestCancelId, setRequestCancelId] = useState<string | null>(null)
  const [requestCancelError, setRequestCancelError] = useState<string | null>(null)
  const [walletReady, setWalletReady] = useState(false)
  const hasRetried401OnMobile = useRef(false)
  const visibilityTick = useVisibilityTick()

  // Use wallet address string in deps so callback identity is stable (publicKey object ref can change every render and cause infinite loop).
  const walletAddr = publicKey?.toBase58() ?? ''

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
    const addr = publicKey.toBase58()
    let skipLoadingFalse = false
    try {
      const res = await fetch('/api/me/dashboard', {
        credentials: 'include',
        headers: { 'X-Connected-Wallet': addr },
      })
      if (res.status === 401) {
        if (typeof window !== 'undefined' && isMobileDevice() && !hasRetried401OnMobile.current) {
          hasRetried401OnMobile.current = true
          skipLoadingFalse = true
          setTimeout(() => loadDashboard(), MOBILE_401_RETRY_DELAY_MS)
          return
        }
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
      if (json.wallet && json.wallet !== addr) {
        setNeedsSignIn(true)
        setData(null)
        return
      }
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      if (!skipLoadingFalse) setLoading(false)
    }
  }, [connected, walletAddr])

  // Reset 401 retry flag when wallet changes so a new connection gets one retry on mobile.
  useEffect(() => {
    hasRetried401OnMobile.current = false
  }, [walletAddr, connected])

  // On mobile, delay first dashboard load so wallet has time to stabilize after nav/redirect.
  // If already connected on mount (e.g. returning from wallet), don't delay so connection feels instant.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isMobileDevice()) {
      setWalletReady(true)
      return
    }
    if (connected && publicKey) {
      setWalletReady(true)
      return
    }
    const t = setTimeout(() => setWalletReady(true), MOBILE_WALLET_STABILIZE_MS)
    return () => clearTimeout(t)
  }, [connected, publicKey])

  // Load dashboard when wallet is ready and when user returns to tab (visibility tick) so connection updates apply right away.
  useEffect(() => {
    if (!walletReady && isMobileDevice()) return
    loadDashboard()
  }, [loadDashboard, walletReady, visibilityTick])

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

  const handleClaimProceeds = useCallback(
    async (raffleId: string) => {
      setClaimActionError(null)
      setClaimProceedsLoadingId(raffleId)
      try {
        const res = await fetch(`/api/raffles/${raffleId}/claim-proceeds`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim proceeds'
          )
          return
        }
        await loadDashboard()
      } finally {
        setClaimProceedsLoadingId(null)
      }
    },
    [loadDashboard]
  )

  const handleClaimPrize = useCallback(
    async (raffleId: string) => {
      setClaimActionError(null)
      setClaimPrizeLoadingId(raffleId)
      try {
        const res = await fetch(`/api/raffles/${raffleId}/claim-prize`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim prize'
          )
          return
        }
        await loadDashboard()
      } finally {
        setClaimPrizeLoadingId(null)
      }
    },
    [loadDashboard]
  )

  const handleClaimRefund = useCallback(
    async (entryId: string) => {
      setClaimActionError(null)
      setClaimRefundLoadingEntryId(entryId)
      try {
        const res = await fetch('/api/entries/claim-refund', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ entryId }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim refund'
          )
          return
        }
        await loadDashboard()
      } finally {
        setClaimRefundLoadingEntryId(null)
      }
    },
    [loadDashboard]
  )

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

  const myRafflesForMemo = Array.isArray(data?.myRaffles) ? data.myRaffles : []
  const myEntriesForMemo = Array.isArray(data?.myEntries) ? data.myEntries : []
  const walletForMemo = typeof data?.wallet === 'string' ? data.wallet : ''

  const pendingCreatorFundClaims = useMemo(
    () =>
      myRafflesForMemo.filter(
        (r) =>
          r.status === 'successful_pending_claims' &&
          r.ticket_payments_to_funds_escrow === true &&
          !r.creator_claimed_at &&
          !!r.settled_at?.trim()
      ),
    [myRafflesForMemo]
  )

  const nftPrizeDashboardRows = useMemo(() => {
    const byId = new Map<string, NftWinnerDashboardRow>()
    for (const { raffle } of myEntriesForMemo) {
      const w = walletForMemo.trim()
      if (!raffle.winner_wallet?.trim() || raffle.winner_wallet.trim() !== w) continue
      if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address?.trim()) continue
      const tx = raffle.nft_transfer_transaction?.trim() || null
      let prizeState: NftWinnerDashboardRow['prizeState']
      if (raffle.prize_returned_at) prizeState = 'returned'
      else if (tx) prizeState = 'claimed'
      else if (canClaimNftPrize(raffle, walletForMemo)) prizeState = 'claimable'
      else prizeState = 'waiting'
      if (!byId.has(raffle.id)) {
        byId.set(raffle.id, { raffle, prizeState, claimedTx: tx })
      }
    }
    return Array.from(byId.values())
  }, [myEntriesForMemo, walletForMemo])

  const cryptoPrizeWinRows = useMemo(() => {
    const byId = new Map<string, EntryWithRaffle['raffle']>()
    for (const { raffle } of myEntriesForMemo) {
      const w = walletForMemo.trim()
      if (!raffle.winner_wallet?.trim() || raffle.winner_wallet.trim() !== w) continue
      if (raffle.prize_type === 'nft') continue
      if (!byId.has(raffle.id)) byId.set(raffle.id, raffle)
    }
    return Array.from(byId.values())
  }, [myEntriesForMemo, walletForMemo])

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

  // Connected but publicKey not ready yet (common on mobile after redirect). Show preparing state.
  if (!publicKey) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex flex-col items-center gap-3 text-center min-h-[120px] justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">
            Preparing your dashboard…
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Wallet is connecting. If this takes more than a few seconds, try going home and opening Dashboard again.
          </p>
        </div>
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
  const myRaffles = myRafflesForMemo
  const myEntries = myEntriesForMemo
  const creatorRevenue = typeof data.creatorRevenue === 'number' ? data.creatorRevenue : 0
  const creatorRevenueByCurrency =
    data.creatorRevenueByCurrency && typeof data.creatorRevenueByCurrency === 'object'
      ? data.creatorRevenueByCurrency
      : {}
  const creatorLiveEarningsByCurrency =
    data.creatorLiveEarningsByCurrency && typeof data.creatorLiveEarningsByCurrency === 'object'
      ? data.creatorLiveEarningsByCurrency
      : {}
  const creatorAllTimeGrossByCurrency =
    data.creatorAllTimeGrossByCurrency && typeof data.creatorAllTimeGrossByCurrency === 'object'
      ? data.creatorAllTimeGrossByCurrency
      : {}
  const feeTier =
    data.feeTier && typeof data.feeTier.feeBps === 'number' && typeof data.feeTier.reason === 'string'
      ? data.feeTier
      : { feeBps: 600, reason: 'standard' as const }
  const wallet = walletForMemo
  const displayName = data.displayName != null ? String(data.displayName) : null

  const sourceEntries =
    entriesFilter === 'won'
      ? myEntries.filter(({ raffle }) => raffle.winner_wallet === wallet)
      : myEntries

  const refundableEntries = myEntries.filter(
    (x) =>
      x.raffle.status === 'failed_refund_available' &&
      x.entry.status === 'confirmed' &&
      !x.entry.refunded_at &&
      x.raffle.ticket_payments_to_funds_escrow === true
  )

  type RaffleEntrySummary = {
    raffle: (typeof myEntries)[number]['raffle']
    totalTickets: number
  }

  const raffleSummaries: RaffleEntrySummary[] = Object.values(
    sourceEntries.reduce<Record<string, RaffleEntrySummary>>((acc, { entry, raffle }) => {
      const key = raffle.id
      const qty = Number(entry.ticket_quantity) || 0
      const existing = acc[key]
      if (existing) {
        existing.totalTickets += qty
      } else {
        acc[key] = {
          raffle,
          totalTickets: qty,
        }
      }
      return acc
    }, {})
  )

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
      setDisplayNameSaved(true)
      setTimeout(() => setDisplayNameSaved(false), 3000)
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
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Input
            placeholder="e.g. Crazyfox"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value.slice(0, 32))}
            maxLength={32}
            className="max-w-xs"
          />
          <div className="flex items-center gap-2">
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
            {displayNameSaved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400" aria-live="polite">
                <Check className="h-4 w-4 shrink-0" />
                Saved
              </span>
            )}
          </div>
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
              New raffles: ticket payments go to funds escrow; the platform fee and your net share are sent when you
              claim proceeds after the draw. Older raffles may still use split-at-purchase.
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
            {creatorRevenue > 0 ? (
              <>
                <p className="text-sm text-muted-foreground mt-1">
                  Your share after the platform fee (claimed escrow settlements plus estimated live sales).
                </p>
                {Object.keys(creatorLiveEarningsByCurrency).length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    From live raffles:{' '}
                    {Object.entries(creatorLiveEarningsByCurrency)
                      .map(([cur, amt]) => `${amt.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
                      .join(' + ')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">No earnings yet from raffles you created</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              All-time gross ticket sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {Object.keys(creatorAllTimeGrossByCurrency).length > 0
                ? Object.entries(creatorAllTimeGrossByCurrency)
                    .map(([cur, amt]) => `${amt.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
                    .join(' + ')
                : '—'}
            </p>
            <p className="text-sm text-muted-foreground">
              Total confirmed ticket volume across your live, ready-to-draw, and completed raffles (before the platform
              fee).
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8 border-green-500/25 bg-green-500/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Gift className="h-5 w-5 shrink-0" />
            Claim prizes & raffle funds
          </CardTitle>
          <CardDescription>
            Signed-in actions only. Claim net ticket proceeds from funds escrow after your raffle draws (platform fee
            goes in the same transaction), or claim an NFT prize from escrow when you won an NFT raffle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {claimActionError && (
            <p className="text-sm text-destructive" role="alert">
              {claimActionError}
            </p>
          )}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Creator funds (your raffles)</p>
            {pendingCreatorFundClaims.length > 0 ? (
              <ul className="space-y-3">
                {pendingCreatorFundClaims.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-3 last:border-0 last:pb-0"
                  >
                    <Link href={`/raffles/${r.slug}`} className="font-medium hover:underline truncate min-w-0">
                      {r.title}
                    </Link>
                    <Button
                      type="button"
                      size="sm"
                      className="touch-manipulation min-h-[44px] shrink-0 w-full sm:w-auto"
                      disabled={claimProceedsLoadingId === r.id}
                      onClick={() => handleClaimProceeds(r.id)}
                    >
                      {claimProceedsLoadingId === r.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Claiming…
                        </>
                      ) : (
                        <>
                          <Coins className="h-4 w-4 mr-2" />
                          Claim funds from raffle
                        </>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to claim here right now. After a raffle you created has settled (winner drawn and payout amounts
                recorded), and it used ticket payments to the funds escrow, your net proceeds will show with a claim
                button.
              </p>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Raffle winners (NFT prizes)</p>
            {nftPrizeDashboardRows.length > 0 ? (
              <ul className="space-y-3">
                {nftPrizeDashboardRows.map(({ raffle, prizeState, claimedTx }) => (
                  <li
                    key={raffle.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-border/40 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0 space-y-1">
                      <Link href={`/raffles/${raffle.slug}`} className="font-medium hover:underline truncate block">
                        {raffle.title}
                      </Link>
                      {prizeState === 'waiting' && (
                        <p className="text-xs text-muted-foreground">
                          Prize not ready to claim yet (waiting for verified escrow deposit or raffle to finish). Open the
                          raffle page for status.
                        </p>
                      )}
                      {prizeState === 'returned' && (
                        <p className="text-xs text-muted-foreground">
                          This prize was returned to the creator and is no longer claimable.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto sm:items-center">
                      {prizeState === 'claimable' ? (
                        <Button
                          type="button"
                          size="sm"
                          className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                          disabled={claimPrizeLoadingId === raffle.id}
                          onClick={() => handleClaimPrize(raffle.id)}
                        >
                          {claimPrizeLoadingId === raffle.id ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Claiming…
                            </>
                          ) : (
                            <>
                              <Gift className="h-4 w-4 mr-2" />
                              Claim raffle prize
                            </>
                          )}
                        </Button>
                      ) : prizeState === 'claimed' && claimedTx ? (
                        <Button type="button" variant="outline" size="sm" className="min-h-[44px] w-full sm:w-auto" asChild>
                          <a href={solscanTxUrl(claimedTx)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            View prize transfer
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No NFT wins to show yet. When you win an NFT raffle and the prize is in escrow, a claim button will
                appear here.
              </p>
            )}
          </div>
          {cryptoPrizeWinRows.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Raffle winners (crypto / SPL prizes)</p>
              <ul className="space-y-2">
                {cryptoPrizeWinRows.map((raffle) => (
                  <li key={raffle.id}>
                    <Link href={`/raffles/${raffle.slug}`} className="text-sm hover:underline">
                      {raffle.title}
                    </Link>
                    <span className="text-sm text-muted-foreground"> — you won; open the raffle for details.</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

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
          {claimActionError && (
            <p className="text-sm text-destructive mb-3" role="alert">
              {claimActionError}
            </p>
          )}
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
                      <span className="flex items-center gap-2 shrink-0 text-sm text-muted-foreground flex-wrap justify-end">
                        <span className="capitalize">{(r.status ?? 'draft').replace(/_/g, ' ')}</span>
                        {r.status === 'successful_pending_claims' &&
                          r.ticket_payments_to_funds_escrow &&
                          !r.creator_claimed_at &&
                          !!r.settled_at?.trim() && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="touch-manipulation min-h-[44px] h-9"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleClaimProceeds(r.id)
                              }}
                              disabled={claimProceedsLoadingId === r.id}
                            >
                              {claimProceedsLoadingId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Coins className="h-4 w-4 sm:mr-1" />
                                  <span className="hidden sm:inline">Claim funds</span>
                                </>
                              )}
                            </Button>
                          )}
                        {r.creator_payout_amount != null &&
                          (r.status === 'completed' ||
                            (r.status === 'successful_pending_claims' && r.creator_claimed_at)) && (
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
                        isOpen ? 'max-h-[28rem] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="pb-3 pl-1 pr-1 text-sm text-muted-foreground space-y-1">
                        {requestCancelError && (
                          <p className="text-destructive text-xs">{requestCancelError}</p>
                        )}
                        {r.status === 'successful_pending_claims' &&
                          r.ticket_payments_to_funds_escrow &&
                          !r.creator_claimed_at &&
                          !!r.settled_at?.trim() && (
                            <div className="py-2">
                              <Button
                                type="button"
                                size="sm"
                                className="touch-manipulation min-h-[44px]"
                                disabled={claimProceedsLoadingId === r.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleClaimProceeds(r.id)
                                }}
                              >
                                {claimProceedsLoadingId === r.id ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Claiming…
                                  </>
                                ) : (
                                  <>
                                    <Coins className="h-4 w-4 mr-2" />
                                    Claim ticket proceeds
                                  </>
                                )}
                              </Button>
                              <p className="text-xs mt-2 text-muted-foreground">
                                Raffle has settled. Claim sends your net share to this wallet and the platform fee to
                                treasury from funds escrow. Sign in is required.
                              </p>
                            </div>
                          )}
                        {r.status === 'successful_pending_claims' &&
                          r.ticket_payments_to_funds_escrow &&
                          !r.creator_claimed_at &&
                          !r.settled_at?.trim() && (
                            <p className="text-xs text-muted-foreground py-2">
                              Waiting for settlement (winner and payout amounts) before you can claim proceeds.
                            </p>
                          )}
                        <p>
                          <span className="font-medium text-foreground">Payout:</span>{' '}
                          {r.creator_payout_amount != null &&
                          (r.status === 'completed' ||
                            (r.status === 'successful_pending_claims' && r.creator_claimed_at))
                            ? `${Number(r.creator_payout_amount).toFixed(
                                r.currency === 'USDC' ? 2 : 4
                              )} ${r.currency}`
                            : r.status === 'successful_pending_claims' &&
                                !r.creator_claimed_at &&
                                r.settled_at?.trim()
                              ? `Pending claim (${Number(r.creator_payout_amount ?? 0).toFixed(
                                  r.currency === 'USDC' ? 2 : 4
                                )} ${r.currency} net after fee)`
                              : r.status === 'successful_pending_claims' && !r.creator_claimed_at
                                ? 'Waiting for settlement before claim'
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
            <CardDescription>Raffles you entered ({raffleSummaries.length})</CardDescription>
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
          {refundableEntries.length > 0 && (
            <div
              className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
              role="region"
              aria-label="Ticket refunds"
            >
              <p className="font-medium text-foreground mb-1">Ticket refunds</p>
              <p className="text-xs text-muted-foreground mb-3">
                This raffle did not reach its minimum after the extension. Claim your ticket payment back from funds
                escrow (mobile: use Wi‑Fi or solid data if the request fails).
              </p>
              <ul className="space-y-2">
                {refundableEntries.slice(0, 15).map(({ entry, raffle }) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-2 last:border-0 last:pb-0"
                  >
                    <Link href={`/raffles/${raffle.slug}`} className="font-medium hover:underline truncate">
                      {raffle.title}
                    </Link>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="touch-manipulation min-h-[44px] shrink-0"
                      disabled={claimRefundLoadingEntryId === entry.id}
                      onClick={() => handleClaimRefund(entry.id)}
                    >
                      {claimRefundLoadingEntryId === entry.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Refunding…
                        </>
                      ) : (
                        `Claim ${Number(entry.amount_paid).toFixed(entry.currency === 'USDC' ? 2 : 4)} ${entry.currency}`
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {raffleSummaries.length === 0 ? (
            <p className="text-muted-foreground">
              {raffleSummaries.length === 0
                ? 'You haven’t entered any raffles yet.'
                : 'No entries match this filter.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {raffleSummaries.slice(0, 20).map(({ raffle, totalTickets }) => {
                return (
                  <li
                    key={raffle.id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <button
                      type="button"
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
                      </span>
                      <span className="flex flex-col items-end gap-2 shrink-0 text-sm text-muted-foreground sm:flex-row sm:items-center">
                        <span className="flex items-center gap-2">
                          {totalTickets} ticket
                          {totalTickets !== 1 ? 's' : ''}
                          {raffle.winner_wallet === wallet && (
                            <span className="text-green-600 font-medium">You won</span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          {raffle.winner_wallet === wallet &&
                            raffle.prize_type === 'nft' &&
                            canClaimNftPrize(raffle as EntryWithRaffle['raffle'], wallet) && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="touch-manipulation min-h-[44px] h-9"
                                disabled={claimPrizeLoadingId === raffle.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleClaimPrize(raffle.id)
                                }}
                              >
                                {claimPrizeLoadingId === raffle.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Gift className="h-4 w-4 mr-1" />
                                    Claim prize
                                  </>
                                )}
                              </Button>
                            )}
                          {raffle.winner_wallet === wallet &&
                            raffle.prize_type === 'nft' &&
                            raffle.nft_transfer_transaction?.trim() && (
                              <Button type="button" variant="outline" size="sm" className="h-9 min-h-[44px]" asChild>
                                <a
                                  href={solscanTxUrl(raffle.nft_transfer_transaction.trim())}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                  Prize tx
                                </a>
                              </Button>
                            )}
                          <Link
                            href={`/raffles/${raffle.slug}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex"
                          >
                            <ExternalLink className="h-4 w-4 hover:text-foreground" />
                          </Link>
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {raffleSummaries.length > 20 && (
            <p className="text-sm text-muted-foreground mt-2">
              Showing latest 20 of {raffleSummaries.length}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
