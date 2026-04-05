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
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { isMobileDevice } from '@/lib/utils'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import type { NftGiveaway } from '@/lib/types'

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
  prize_deposited_at?: string | null
  winner_wallet?: string | null
  winner_selected_at?: string | null
  cancellation_requested_at?: string | null
  ticket_payments_to_funds_escrow?: boolean | null
  creator_claimed_at?: string | null
  creator_claim_tx?: string | null
  settled_at?: string | null
  fee_bps_applied?: number | null
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

function solscanTokenUrl(mint: string): string {
  const dev = /devnet/i.test(resolvePublicSolanaRpcUrl())
  return `https://solscan.io/token/${encodeURIComponent(mint)}${dev ? '?cluster=devnet' : ''}`
}

/** Readable status for creator list (DB uses snake_case; some states need clearer wording). */
function myRaffleStatusLabel(status: string | null): string {
  const s = status ?? 'draft'
  if (s === 'successful_pending_claims') return 'Settled — claim proceeds'
  return s.replace(/_/g, ' ')
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
  claimTrackerLiveFundsEscrowSales?: {
    netByCurrency: Record<string, number>
    feeByCurrency: Record<string, number>
    grossByCurrency: Record<string, number>
    trackedRaffleIds?: string[]
  }
  creatorRefundRaffles?: Array<{
    raffleId: string
    raffleSlug: string
    raffleTitle: string
    currency: string
    totalPending: number
    candidates: Array<{
      wallet: string
      totalAmount: number
      refundedAmount: number
      pendingAmount: number
      confirmedEntries: number
      refundedEntries: number
    }>
  }>
  feeTier: FeeTier
  nftGiveaways?: NftGiveaway[]
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

const MY_ENTRIES_PAGE_SIZE = 20
/** Background refresh for claim tracker + dashboard numbers while tab is open */
const CLAIM_TRACKER_POLL_MS = 18_000

function formatRelativeUpdated(updatedAt: number): string {
  const s = Math.floor((Date.now() - updatedAt) / 1000)
  if (s < 8) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function aggregateClaimTotalsByCurrency(
  raffles: Raffle[],
  field: 'creator_payout_amount' | 'platform_fee_amount'
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of raffles) {
    const cur = (r.currency || 'SOL').toUpperCase()
    const raw = field === 'creator_payout_amount' ? r.creator_payout_amount : r.platform_fee_amount
    const v = Number(raw ?? 0)
    if (!Number.isFinite(v) || v <= 0) continue
    out[cur] = (out[cur] ?? 0) + v
  }
  return out
}

function formatMultiCurrencyTotals(by: Record<string, number>): string {
  const keys = Object.keys(by)
  if (keys.length === 0) return '—'
  return keys
    .map((cur) => `${by[cur]!.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
    .join(' · ')
}


type RaffleEntrySummary = {
  raffle: EntryWithRaffle['raffle']
  totalTickets: number
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
  const [entriesPage, setEntriesPage] = useState(0)
  const [openRaffleId, setOpenRaffleId] = useState<string | null>(null)
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSaved, setDisplayNameSaved] = useState(false)
  const [escrowLinkLoadingId, setEscrowLinkLoadingId] = useState<string | null>(null)
  const [claimProceedsLoadingId, setClaimProceedsLoadingId] = useState<string | null>(null)
  const [claimPrizeLoadingId, setClaimPrizeLoadingId] = useState<string | null>(null)
  const [claimGiveawayLoadingId, setClaimGiveawayLoadingId] = useState<string | null>(null)
  const [claimRefundLoadingEntryId, setClaimRefundLoadingEntryId] = useState<string | null>(null)
  const [claimActionError, setClaimActionError] = useState<string | null>(null)
  const [requestCancelId, setRequestCancelId] = useState<string | null>(null)
  const [requestCancelError, setRequestCancelError] = useState<string | null>(null)
  const [walletReady, setWalletReady] = useState(false)
  const [claimTrackerRefreshing, setClaimTrackerRefreshing] = useState(false)
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState<number | null>(null)
  const [relativeTimeTick, setRelativeTimeTick] = useState(0)
  const hasRetried401OnMobile = useRef(false)
  const dashboardHydratedRef = useRef(false)
  const hasDashboardDataRef = useRef(false)
  const visibilityTick = useVisibilityTick()

  // Use wallet address string in deps so callback identity is stable (publicKey object ref can change every render and cause infinite loop).
  const walletAddr = publicKey?.toBase58() ?? ''

  const loadDashboard = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!connected || !publicKey) {
      setData(null)
      setLoading(false)
      setNeedsSignIn(false)
      setError(null)
      setClaimTrackerRefreshing(false)
      return
    }
    if (silent) {
      setClaimTrackerRefreshing(true)
    } else {
      setLoading(true)
      setError(null)
      setNeedsSignIn(false)
    }
    const addr = publicKey.toBase58()
    let skipLoadingFalse = false
    try {
      const res = await fetch('/api/me/dashboard', {
        credentials: 'include',
        headers: { 'X-Connected-Wallet': addr },
      })
      if (res.status === 401) {
        if (typeof window !== 'undefined' && isMobileDevice() && !hasRetried401OnMobile.current && !silent) {
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
        if (!silent) {
          const msg = typeof json?.error === 'string' ? json.error : 'Failed to load dashboard'
          setError(msg)
        }
        return
      }
      if (json.wallet && json.wallet !== addr) {
        setNeedsSignIn(true)
        setData(null)
        return
      }
      setData(json)
      setDashboardUpdatedAt(Date.now())
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    } finally {
      if (silent) {
        setClaimTrackerRefreshing(false)
      }
      if (!skipLoadingFalse && !silent) {
        setLoading(false)
      }
    }
  }, [connected, walletAddr])

  // Reset 401 retry flag when wallet changes so a new connection gets one retry on mobile.
  useEffect(() => {
    hasRetried401OnMobile.current = false
  }, [walletAddr, connected])

  useEffect(() => {
    dashboardHydratedRef.current = false
  }, [walletAddr])

  useEffect(() => {
    hasDashboardDataRef.current = data != null
    if (data) {
      dashboardHydratedRef.current = true
    }
  }, [data])

  useEffect(() => {
    if (!data) return
    const id = setInterval(() => setRelativeTimeTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [data])

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

  // Load dashboard when wallet is ready; on tab focus refresh silently if we already have data (no full-page spinner).
  useEffect(() => {
    if (!walletReady && isMobileDevice()) return
    if (visibilityTick > 0 && dashboardHydratedRef.current) {
      void loadDashboard({ silent: true })
      return
    }
    void loadDashboard()
  }, [loadDashboard, walletReady, visibilityTick])

  // Live poll while signed in so claim amounts and live sales update without refreshing the page.
  useEffect(() => {
    if (!connected || !publicKey || needsSignIn) return
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (!hasDashboardDataRef.current) return
      void loadDashboard({ silent: true })
    }, CLAIM_TRACKER_POLL_MS)
    return () => clearInterval(id)
  }, [connected, walletAddr, needsSignIn, loadDashboard])

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
        await loadDashboard({ silent: true })
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
        await loadDashboard({ silent: true })
      } finally {
        setClaimPrizeLoadingId(null)
      }
    },
    [loadDashboard]
  )

  const handleClaimGiveaway = useCallback(
    async (giveawayId: string) => {
      if (!publicKey) return
      setClaimActionError(null)
      setClaimGiveawayLoadingId(giveawayId)
      try {
        const addr = publicKey.toBase58()
        const res = await fetch(`/api/me/nft-giveaways/${giveawayId}/claim`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Connected-Wallet': addr },
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setClaimActionError(
            typeof (json as { error?: string }).error === 'string'
              ? (json as { error: string }).error
              : 'Could not claim giveaway'
          )
          return
        }
        await loadDashboard({ silent: true })
      } finally {
        setClaimGiveawayLoadingId(null)
      }
    },
    [loadDashboard, publicKey]
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
        await loadDashboard({ silent: true })
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
        void loadDashboard({ silent: true })
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
          raffleUsesFundsEscrow(r) &&
          !r.creator_claimed_at &&
          !!r.settled_at?.trim()
      ),
    [myRafflesForMemo]
  )

  const awaitingSettlementEscrowClaims = useMemo(
    () =>
      myRafflesForMemo.filter(
        (r) =>
          r.status === 'successful_pending_claims' &&
          raffleUsesFundsEscrow(r) &&
          !r.creator_claimed_at &&
          !r.settled_at?.trim()
      ),
    [myRafflesForMemo]
  )

  const liveEscrowRaffles = useMemo(() => {
    const tracked = data?.claimTrackerLiveFundsEscrowSales?.trackedRaffleIds
    const trackedSet = Array.isArray(tracked) ? new Set(tracked) : null
    return myRafflesForMemo.filter((r) => {
      if (r.status !== 'live' && r.status !== 'ready_to_draw') return false
      if (trackedSet) return trackedSet.has(r.id)
      return raffleUsesFundsEscrow(r)
    })
  }, [myRafflesForMemo, data?.claimTrackerLiveFundsEscrowSales?.trackedRaffleIds])

  /** End time passed, still live/ready_to_draw, no winner — claim button cannot appear until draw runs. */
  const creatorRafflesEndedAwaitingDraw = useMemo(() => {
    const nowMs = Date.now()
    return myRafflesForMemo.filter((r) => {
      if (!raffleUsesFundsEscrow(r)) return false
      if (r.status !== 'live' && r.status !== 'ready_to_draw') return false
      const endMs = new Date(r.end_time).getTime()
      if (Number.isNaN(endMs) || endMs > nowMs) return false
      if (r.winner_wallet?.trim() || r.winner_selected_at) return false
      if (r.prize_type === 'nft' && !r.prize_deposited_at) return false
      return true
    })
  }, [myRafflesForMemo])

  const claimTrackerLiveSales = useMemo(() => {
    const s = data?.claimTrackerLiveFundsEscrowSales
    if (!s || typeof s !== 'object') {
      return { net: {}, fee: {}, gross: {} } as const
    }
    const asRec = (x: unknown) =>
      x && typeof x === 'object' ? (x as Record<string, number>) : {}
    return {
      net: asRec(s.netByCurrency),
      fee: asRec(s.feeByCurrency),
      gross: asRec(s.grossByCurrency),
    }
  }, [data?.claimTrackerLiveFundsEscrowSales])

  const claimTrackerHasLiveEscrowSales = useMemo(() => {
    const hasPositive = (o: Record<string, number>) =>
      Object.values(o).some((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
    return (
      hasPositive(claimTrackerLiveSales.net) ||
      hasPositive(claimTrackerLiveSales.fee) ||
      hasPositive(claimTrackerLiveSales.gross)
    )
  }, [claimTrackerLiveSales])

  const claimTrackerReadyNetByCurrency = useMemo(
    () => aggregateClaimTotalsByCurrency(pendingCreatorFundClaims, 'creator_payout_amount'),
    [pendingCreatorFundClaims]
  )
  const claimTrackerReadyFeeByCurrency = useMemo(
    () => aggregateClaimTotalsByCurrency(pendingCreatorFundClaims, 'platform_fee_amount'),
    [pendingCreatorFundClaims]
  )

  const claimTrackerReadyGrossByCurrency = useMemo(() => {
    const keys = new Set([
      ...Object.keys(claimTrackerReadyNetByCurrency),
      ...Object.keys(claimTrackerReadyFeeByCurrency),
    ])
    const out: Record<string, number> = {}
    for (const k of keys) {
      const t =
        (claimTrackerReadyNetByCurrency[k] ?? 0) + (claimTrackerReadyFeeByCurrency[k] ?? 0)
      if (t > 0) out[k] = t
    }
    return out
  }, [claimTrackerReadyNetByCurrency, claimTrackerReadyFeeByCurrency])

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

  const raffleSummaries = useMemo((): RaffleEntrySummary[] => {
    const sourceEntries =
      entriesFilter === 'won'
        ? myEntriesForMemo.filter(({ raffle }) => raffle.winner_wallet === walletForMemo)
        : myEntriesForMemo
    return Object.values(
      sourceEntries.reduce<Record<string, RaffleEntrySummary>>((acc, { entry, raffle }) => {
        const key = raffle.id
        const qty = Number(entry.ticket_quantity) || 0
        const existing = acc[key]
        if (existing) {
          existing.totalTickets += qty
        } else {
          acc[key] = { raffle, totalTickets: qty }
        }
        return acc
      }, {})
    )
  }, [myEntriesForMemo, entriesFilter, walletForMemo])

  const entriesListMaxPage =
    raffleSummaries.length === 0
      ? 0
      : Math.ceil(raffleSummaries.length / MY_ENTRIES_PAGE_SIZE) - 1

  useEffect(() => {
    setEntriesPage(0)
  }, [entriesFilter])

  useEffect(() => {
    setEntriesPage((p) => Math.min(p, entriesListMaxPage))
  }, [entriesListMaxPage])

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
  const creatorRefundRaffles = Array.isArray(data.creatorRefundRaffles) ? data.creatorRefundRaffles : []

  const refundableEntries = myEntries.filter(
    (x) =>
      x.raffle.status === 'failed_refund_available' &&
      x.entry.status === 'confirmed' &&
      !x.entry.refunded_at &&
      raffleUsesFundsEscrow(x.raffle)
  )

  const entriesPageSafe = Math.min(entriesPage, entriesListMaxPage)
  const raffleSummariesPage = raffleSummaries.slice(
    entriesPageSafe * MY_ENTRIES_PAGE_SIZE,
    entriesPageSafe * MY_ENTRIES_PAGE_SIZE + MY_ENTRIES_PAGE_SIZE
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

      <Card className="mb-8 border-emerald-500/25 bg-emerald-500/[0.04]">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle className="flex items-center gap-2.5 text-base sm:text-lg">
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-35" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                Live claim tracker
              </CardTitle>
              <CardDescription>
                Escrow claim totals and settlement status update about every{' '}
                {Math.round(CLAIM_TRACKER_POLL_MS / 1000)} seconds while this tab is open, when you return to the tab,
                or when you tap refresh. Creator revenue and gross sales above use the same refresh.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {dashboardUpdatedAt != null && (
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  key={relativeTimeTick}
                >
                  Updated {formatRelativeUpdated(dashboardUpdatedAt)}
                </span>
              )}
              {claimTrackerRefreshing && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch-manipulation min-h-[44px]"
                disabled={claimTrackerRefreshing}
                onClick={() => void loadDashboard({ silent: true })}
              >
                <RefreshCw className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Refresh now</span>
                <span className="sm:hidden">Refresh</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Ready to claim (net to you)</p>
              <p className="text-lg font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerReadyNetByCurrency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {pendingCreatorFundClaims.length} raffle
                {pendingCreatorFundClaims.length === 1 ? '' : 's'} settled — use{' '}
                <span className="font-medium text-foreground">Claim now</span> in this card or{' '}
                <span className="font-medium text-foreground">Creator funds</span> below
              </p>
              <p className="text-xs font-medium text-muted-foreground mt-2.5 mb-0.5">Live raffles (net in escrow)</p>
              <p className="text-base font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerLiveSales.net)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Estimated from confirmed ticket sales on funds-escrow raffles still live or waiting to draw.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Platform fee (same claim tx)</p>
              <p className="text-lg font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerReadyFeeByCurrency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Goes to treasury when you claim</p>
              <p className="text-xs font-medium text-muted-foreground mt-2.5 mb-0.5">Live raffles (fee in escrow)</p>
              <p className="text-base font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerLiveSales.fee)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Same fee tier as your dashboard; included when you claim after the draw.</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 p-3 sm:col-span-1">
              <p className="text-xs font-medium text-muted-foreground mb-1">Gross in escrow (pre-claim)</p>
              <p className="text-lg font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerReadyGrossByCurrency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Net + fee for raffles ready to claim</p>
              <p className="text-xs font-medium text-muted-foreground mt-2.5 mb-0.5">Live raffles (gross in escrow)</p>
              <p className="text-base font-semibold tabular-nums break-words">
                {formatMultiCurrencyTotals(claimTrackerLiveSales.gross)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Total confirmed ticket volume still in funds escrow before the draw.</p>
            </div>
          </div>

          {pendingCreatorFundClaims.length > 0 && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.09] p-3 sm:p-4">
              <p className="text-sm font-semibold text-foreground mb-1">Claim now — ticket proceeds (funds escrow)</p>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                One transaction sends your net share to this wallet and the platform fee to treasury. Same action as in
                “Creator funds” below.
              </p>
              <ul className="space-y-3">
                {pendingCreatorFundClaims.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/30 pb-3 last:border-0 last:pb-0"
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
                          Claim funds
                        </>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {awaitingSettlementEscrowClaims.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">
                Waiting for settlement ({awaitingSettlementEscrowClaims.length})
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Winner recorded; payout lines are being finalized. Amounts appear here when ready.
              </p>
              <ul className="space-y-1.5 text-sm">
                {awaitingSettlementEscrowClaims.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    <Link href={`/raffles/${r.slug}`} className="text-primary hover:underline font-medium">
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {awaitingSettlementEscrowClaims.length > 8 && (
                <p className="text-xs text-muted-foreground mt-2">
                  +{awaitingSettlementEscrowClaims.length - 8} more in My raffles
                </p>
              )}
            </div>
          )}

          {liveEscrowRaffles.length > 0 && (
            <div className="rounded-lg border border-dashed border-border/70 p-3">
              <p className="text-sm font-medium text-foreground">
                Ticket sales still in funds escrow ({liveEscrowRaffles.length} raffle
                {liveEscrowRaffles.length === 1 ? '' : 's'})
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Live and ready-to-draw raffles keep gross proceeds in escrow until the draw. The top row stays “—” until
                a winner is drawn; then your net and fee move to “ready to claim.” Watch{' '}
                <span className="font-medium text-foreground">Creator revenue</span> and{' '}
                <span className="font-medium text-foreground">All-time gross ticket sales</span> above as purchases
                confirm.
              </p>
            </div>
          )}

          {creatorRafflesEndedAwaitingDraw.length > 0 && (
            <div
              className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-3"
              role="status"
            >
              <p className="text-sm font-medium text-foreground">End time passed — winner draw still pending</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Your claim button only appears <span className="font-medium text-foreground">after</span> a winner is
                chosen and settlement is recorded. Open each raffle page once to run the draw immediately, or wait for
                the automatic job (about every 15 minutes).
              </p>
              <ul className="mt-2.5 space-y-1.5 text-sm">
                {creatorRafflesEndedAwaitingDraw.slice(0, 10).map((r) => (
                  <li key={r.id}>
                    <Link href={`/raffles/${r.slug}`} className="text-primary font-medium hover:underline">
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {creatorRafflesEndedAwaitingDraw.length > 10 && (
                <p className="text-xs text-muted-foreground mt-2">
                  +{creatorRafflesEndedAwaitingDraw.length - 10} more in My raffles below
                </p>
              )}
            </div>
          )}

          {pendingCreatorFundClaims.length === 0 &&
            awaitingSettlementEscrowClaims.length === 0 &&
            liveEscrowRaffles.length === 0 &&
            !claimTrackerHasLiveEscrowSales && (
              <p className="text-sm text-muted-foreground">
                No active escrow claim pipeline right now. When you host funds-escrow raffles, live sales show in the
                tracker above; after a draw, ready-to-claim totals appear in the top row of each column until you claim.
              </p>
            )}
        </CardContent>
      </Card>

      <Card className="mb-8 border-green-500/25 bg-green-500/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Gift className="h-5 w-5 shrink-0" />
            Claim prizes & raffle funds
          </CardTitle>
          <CardDescription>
            Signed-in actions only. Claim net ticket proceeds from funds escrow after your raffle draws (platform fee
            goes in the same transaction), claim an NFT prize from escrow when you won an NFT raffle, or claim
            team giveaways listed below when you are the eligible wallet.
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
            ) : creatorRafflesEndedAwaitingDraw.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Nothing to claim yet: these raffles are past their end time but still need a winner draw before
                  proceeds unlock. Open the raffle (or wait ~15 minutes for the automatic draw).
                </p>
                <ul className="text-sm space-y-1">
                  {creatorRafflesEndedAwaitingDraw.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <Link href={`/raffles/${r.slug}`} className="text-primary font-medium hover:underline">
                        {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : liveEscrowRaffles.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                You have ticket sales in funds escrow, but the raffle has not finished yet (or the winner draw has not
                run). The claim button appears here only after the end time passes and a winner is drawn.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to claim here right now. After a raffle you created has settled (winner drawn and payout amounts
                recorded), and it used ticket payments to the funds escrow, your net proceeds will show with a claim
                button.
              </p>
            )}
          </div>
          {Array.isArray(data.nftGiveaways) && data.nftGiveaways.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Giveaway NFTs</p>
              <p className="text-xs text-muted-foreground mb-3">
                One-off drops from the team: when the prize is verified in escrow, claim here with this wallet (same as
                sign-in). On mobile, use Wi‑Fi or solid data and a reliable RPC if claim fails once.
              </p>
              <ul className="space-y-3">
                {data.nftGiveaways.map((g) => {
                  const claimed = Boolean(g.claimed_at)
                  const ready = Boolean(g.prize_deposited_at) && !claimed
                  const label = g.title?.trim() || 'Giveaway NFT'
                  return (
                    <li
                      key={g.id}
                      className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-border/40 pb-3 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium truncate">{label}</p>
                        <p className="text-xs text-muted-foreground break-all">
                          Asset:{' '}
                          <a
                            href={solscanTokenUrl(g.nft_mint_address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {g.nft_mint_address.length > 12
                              ? `${g.nft_mint_address.slice(0, 6)}…${g.nft_mint_address.slice(-6)}`
                              : g.nft_mint_address}
                          </a>
                          {g.prize_standard ? (
                            <span className="text-muted-foreground"> · {g.prize_standard}</span>
                          ) : null}
                        </p>
                        {!g.prize_deposited_at && (
                          <p className="text-xs text-muted-foreground">
                            Waiting for the team to confirm the deposit to escrow.
                          </p>
                        )}
                        {claimed && g.claim_tx_signature && (
                          <a
                            href={solscanTxUrl(g.claim_tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View claim transaction
                          </a>
                        )}
                        <Link
                          href={`/giveaway/${g.id}`}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline inline-block"
                        >
                          Open giveaway page (share link)
                        </Link>
                      </div>
                      <div className="shrink-0 w-full sm:w-auto">
                        {ready ? (
                          <Button
                            type="button"
                            size="sm"
                            className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                            disabled={claimGiveawayLoadingId === g.id}
                            onClick={() => handleClaimGiveaway(g.id)}
                          >
                            {claimGiveawayLoadingId === g.id ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Claiming…
                              </>
                            ) : (
                              <>
                                <Gift className="h-4 w-4 mr-2" />
                                Claim NFT
                              </>
                            )}
                          </Button>
                        ) : claimed ? (
                          <p className="text-sm text-muted-foreground py-2">Claimed</p>
                        ) : (
                          <p className="text-sm text-muted-foreground py-2">Not ready</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
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
                        <span className="capitalize">{myRaffleStatusLabel(r.status)}</span>
                        {r.status === 'successful_pending_claims' &&
                          raffleUsesFundsEscrow(r) &&
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
                          raffleUsesFundsEscrow(r) &&
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
                          raffleUsesFundsEscrow(r) &&
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
                          <span className="capitalize">{myRaffleStatusLabel(r.status)}</span>
                        </p>
                        {r.status === 'completed' && (
                          <div className="text-xs text-muted-foreground space-y-2 pt-1 border-t border-border/40 mt-2">
                            {raffleUsesFundsEscrow(r) && r.creator_claim_tx?.trim() ? (
                              <p>
                                Ticket proceeds from escrow were already sent to your creator wallet in{' '}
                                <a
                                  href={solscanTxUrl(r.creator_claim_tx.trim())}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline underline-offset-2 inline-flex items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  this Solscan transaction
                                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                                </a>
                                . There is no second claim after the raffle shows completed.
                              </p>
                            ) : null}
                            {raffleUsesFundsEscrow(r) && !r.creator_claim_tx?.trim() ? (
                              <p>
                                This raffle is marked completed but no on-chain proceeds transaction is on file. If you
                                never completed &ldquo;Claim proceeds,&rdquo; contact support with this raffle so the team
                                can reconcile escrow and your wallet.
                              </p>
                            ) : null}
                            {!raffleUsesFundsEscrow(r) ? (
                              <p>
                                This raffle used per-purchase payment splits: your share of each ticket arrived when
                                buyers paid. There is no separate claim after the draw. The payout figure above is your
                                recorded net from those sales.
                              </p>
                            ) : null}
                            <p>
                              On the raffle page, <span className="font-medium text-foreground">Amount over threshold</span>{' '}
                              is profit above your configured prize value, NFT floor, or draw minimum—what you keep as surplus
                              once ticket revenue passes that bar. The <span className="font-medium text-foreground">Payout</span>{' '}
                              line here is your net from <span className="font-medium text-foreground">all</span> ticket
                              sales after the platform fee, not only the over-threshold portion.
                            </p>
                          </div>
                        )}
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

      {creatorRefundRaffles.length > 0 && (
        <Card className="mb-8 border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Users to refund (my raffles)</CardTitle>
            <CardDescription>
              Raffles that did not meet minimum threshold. Share these exact payout lines with users or use them to send manual refunds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {creatorRefundRaffles.map((rr) => {
              const payoutScript = rr.candidates
                .filter((c) => c.pendingAmount > 0)
                .map(
                  (c, i) =>
                    `${i + 1}. Send ${c.pendingAmount.toFixed(rr.currency === 'USDC' ? 2 : 6)} ${rr.currency} to ${c.wallet}`
                )
                .join('\n')
              return (
                <div key={rr.raffleId} className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/raffles/${rr.raffleSlug}`} className="font-medium hover:underline truncate">
                      {rr.raffleTitle}
                    </Link>
                    <span className="text-sm font-semibold">
                      Pending:{' '}
                      {rr.totalPending.toFixed(rr.currency === 'USDC' ? 2 : 6)} {rr.currency}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                    onClick={async () => {
                      if (!payoutScript) return
                      try {
                        await navigator.clipboard.writeText(payoutScript)
                      } catch {
                        // best-effort only
                      }
                    }}
                  >
                    Copy payout script
                  </Button>
                  <div className="max-h-56 overflow-auto space-y-2">
                    {rr.candidates.map((c, idx) => (
                      <div key={`${rr.raffleId}-${c.wallet}`} className="rounded border border-border/50 bg-muted/30 p-2">
                        <p className="text-xs text-muted-foreground">User #{idx + 1}</p>
                        <p className="text-xs font-mono break-all">{c.wallet}</p>
                        <p className="text-sm mt-1">
                          <span className="text-muted-foreground">Amount to refund: </span>
                          <span className="font-mono font-semibold">
                            {c.pendingAmount.toFixed(rr.currency === 'USDC' ? 2 : 6)} {rr.currency}
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

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
              {myEntries.length === 0
                ? 'You haven’t entered any raffles yet.'
                : 'No entries match this filter.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {raffleSummariesPage.map(({ raffle, totalTickets }) => {
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
          {raffleSummaries.length > MY_ENTRIES_PAGE_SIZE && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing{' '}
                {entriesPageSafe * MY_ENTRIES_PAGE_SIZE + 1}–
                {Math.min(
                  (entriesPageSafe + 1) * MY_ENTRIES_PAGE_SIZE,
                  raffleSummaries.length
                )}{' '}
                of {raffleSummaries.length}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch-manipulation min-h-[44px] flex-1 sm:flex-initial"
                  disabled={entriesPageSafe <= 0}
                  onClick={() => setEntriesPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4 shrink-0" aria-hidden />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch-manipulation min-h-[44px] flex-1 sm:flex-initial"
                  disabled={entriesPageSafe >= entriesListMaxPage}
                  onClick={() =>
                    setEntriesPage((p) => Math.min(entriesListMaxPage, p + 1))
                  }
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4 shrink-0" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
